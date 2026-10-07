/**
 * Remote plugin registry (Supabase, ADR §6.10): table `content_plugins` +
 * private bucket `content-plugins` (`<hex>.wasm`, `<hex>.ui.js`).
 *
 * The plugin store talks to the `PluginRemote` interface; the Supabase
 * implementation is installed by `app/plugins/01.content-plugins.client.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentPluginManifest, ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import type { Database, Json } from '~/types/database.types';

/** Who can read a published plugin. */
export type PluginVisibility = 'private' | 'project' | 'public';

/** Listing entry (no binaries). */
export interface RemotePluginInfo {
  hash: string;
  manifest: ContentPluginManifest;
  ownerId: string;
  visibility: PluginVisibility;
  projectId: string | null;
  createdAt: string | null;
}

/** Remote operations used by the plugin store. */
export interface PluginRemote {
  /** Current user id (null when signed out). */
  userId(): Promise<string | null>;
  /** Full package incl. binaries, or null when unknown/unreadable. */
  fetch(hash: string): Promise<(ContentPluginPackage & { ownerId: string }) | null>;
  /** Uploads a package (row first, then blobs). Idempotent for own hashes. */
  publish(pkg: ContentPluginPackage, visibility: PluginVisibility, projectId?: string | null): Promise<void>;
  /** Readable plugins: own, of a project, or public. */
  list(filter: { mine?: boolean; projectId?: string; public?: boolean }): Promise<RemotePluginInfo[]>;
  /** Readable plugins with this alias, newest first. */
  findByAlias(alias: string): Promise<RemotePluginInfo[]>;
}

/** Bucket object name of a hash's artifact. */
export function blobName(hash: string, ext: 'wasm' | 'ui.js'): string {
  return `${hash.replace(/^sha256:/, '')}.${ext}`;
}

type Row = Database['public']['Tables']['content_plugins']['Row'];

/** Maps a row to a listing entry. */
function info(row: Row): RemotePluginInfo {
  return {
    hash: row.hash,
    manifest: row.manifest as unknown as ContentPluginManifest,
    ownerId: row.owner_id,
    visibility: row.visibility as PluginVisibility,
    projectId: row.project_id,
    createdAt: row.created_at,
  };
}

/** Supabase-backed remote. */
export function createSupabaseRemote(supabase: SupabaseClient<Database>): PluginRemote {
  const bucket = () => supabase.storage.from('content-plugins');

  return {
    async userId() {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },

    async fetch(hash) {
      const { data: row, error } = await supabase.from('content_plugins').select('*').eq('hash', hash).maybeSingle();
      if (error) throw error;
      if (!row) return null;
      const manifest = row.manifest as unknown as ContentPluginManifest;
      const wasmRes = await bucket().download(blobName(hash, 'wasm'));
      if (wasmRes.error || !wasmRes.data) throw wasmRes.error ?? new Error(`missing wasm for ${hash}`);
      let uiJs: string | undefined;
      if (manifest.ui) {
        const uiRes = await bucket().download(blobName(hash, 'ui.js'));
        if (uiRes.error || !uiRes.data) throw uiRes.error ?? new Error(`missing ui for ${hash}`);
        uiJs = await uiRes.data.text();
      }
      return {
        hash,
        manifest,
        wasm: new Uint8Array(await wasmRes.data.arrayBuffer()),
        uiJs,
        source: row.source as unknown as Record<string, string>,
        toolchain: row.toolchain,
        ownerId: row.owner_id,
      };
    },

    async publish(pkg, visibility, projectId = null) {
      const { error } = await supabase.from('content_plugins').insert({
        hash: pkg.hash,
        alias: pkg.manifest.alias,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        kind: pkg.manifest.kind,
        manifest: pkg.manifest as unknown as Json,
        source: pkg.source as unknown as Json,
        toolchain: pkg.toolchain,
        visibility,
        project_id: projectId,
      });
      // 23505 = already published (immutable rows): fine when it is readable.
      if (error && error.code !== '23505') throw error;
      const up = async (name: string, body: Blob) => {
        const res = await bucket().upload(name, body, { upsert: false });
        // An existing object means a previous publish got this far.
        if (res.error && !/exists|duplicate/i.test(res.error.message)) throw res.error;
      };
      await up(blobName(pkg.hash, 'wasm'), new Blob([pkg.wasm as BlobPart], { type: 'application/wasm' }));
      if (pkg.uiJs) await up(blobName(pkg.hash, 'ui.js'), new Blob([pkg.uiJs], { type: 'text/javascript' }));
    },

    async list(filter) {
      const out = new Map<string, RemotePluginInfo>();
      const add = (rows: Row[] | null) => rows?.forEach(r => out.set(r.hash, info(r)));
      const uid = filter.mine ? await this.userId() : null;
      if (uid) add((await supabase.from('content_plugins').select('*').eq('owner_id', uid).order('created_at', { ascending: false })).data);
      if (filter.projectId) add((await supabase.from('content_plugins').select('*').eq('project_id', filter.projectId)).data);
      if (filter.public) add((await supabase.from('content_plugins').select('*').eq('visibility', 'public').order('created_at', { ascending: false }).limit(200)).data);
      return [...out.values()];
    },

    async findByAlias(alias) {
      const { data, error } = await supabase.from('content_plugins').select('*').eq('alias', alias).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []).map(info);
    },
  };
}
