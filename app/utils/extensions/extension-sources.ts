/**
 * Where extension bundles come from (ADR §5.9): the app's own catalog
 * (`/extensions/catalog.json`, built by `scripts/build-extensions.ts`) and
 * the Supabase registry (`extensions` table + public `extensions` bucket).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';

/** A catalog listing entry. */
export interface ExtensionListing {
  id: string;
  version: string;
  apiVersion: string;
  displayName: string;
  description: string;
  /** Where it was found. */
  source: 'catalog' | 'registry';
}

/** A downloaded bundle. */
export interface BundleFiles {
  js: string;
  css: string | null;
  info: Record<string, unknown>;
}

/** A bundle source. */
export interface ExtensionSource {
  /** Every published id@version. */
  list(): Promise<ExtensionListing[]>;
  /** Downloads one bundle. */
  fetch(id: string, version: string): Promise<BundleFiles>;
}

/** Fetches text; throws on HTTP errors. */
async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** The app's bundled catalog under `baseUrl` (default `/extensions`). */
export function catalogSource(baseUrl = '/extensions'): ExtensionSource {
  return {
    async list() {
      try {
        const data = JSON.parse(await text(`${baseUrl}/catalog.json`)) as { extensions?: Omit<ExtensionListing, 'source'>[] };
        return (data.extensions ?? []).map(e => ({ ...e, source: 'catalog' as const }));
      }
      catch {
        return [];
      }
    },
    async fetch(id, version) {
      const dir = `${baseUrl}/${id}/${version}`;
      const info = JSON.parse(await text(`${dir}/extension.json`)) as Record<string, unknown>;
      const files = info.files as { js?: string; css?: string | null } | undefined;
      const js = await text(`${dir}/${files?.js ?? 'index.js'}`);
      const css = files?.css ? await text(`${dir}/${files.css}`) : null;
      return { js, css, info };
    },
  };
}

/** The Supabase extension registry. */
export function registrySource(supabase: SupabaseClient<Database>): ExtensionSource {
  const bucket = () => supabase.storage.from('extensions');
  return {
    async list() {
      const { data, error } = await supabase.from('extensions').select('id, version, manifest').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const m = r.manifest as Record<string, string>;
        return { id: r.id, version: r.version, apiVersion: m.apiVersion ?? '*', displayName: m.displayName ?? r.id, description: m.description ?? '', source: 'registry' as const };
      });
    },
    async fetch(id, version) {
      const url = (path: string) => bucket().getPublicUrl(`${id}/${version}/${path}`).data.publicUrl;
      const info = JSON.parse(await text(url('extension.json'))) as Record<string, unknown>;
      const files = info.files as { js?: string; css?: string | null } | undefined;
      return {
        js: await text(url(files?.js ?? 'index.js')),
        css: files?.css ? await text(url(files.css)) : null,
        info,
      };
    },
  };
}
