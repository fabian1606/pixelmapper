/**
 * Export / import of `.pmproject` archives (plan P6.8).
 *
 * Export: the current snapshot, every referenced non-built-in content
 * plugin (full package incl. source) and bundles of the required extensions
 * (from the loader cache or catalog; distribution-set layers have none).
 * Import: plugins are rebuilt from source and must reproduce their hash,
 * bundles go to the loader cache (installable offline after the warning),
 * then a new project is created from the snapshot.
 */
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { getPackage, isBuiltin, resolve } from '~/utils/plugins/plugin-store';
import { importPluginFile } from '~/utils/plugins/import-plugin';
import { cacheBundle, getBundle } from '~/utils/extensions/loader';
import type { CachedBundle } from '~/utils/extensions/extension-cache';
import { buildProjectArchive, readProjectArchive, referencedPluginHashes } from './project-archive';

/** Collects plugins and bundles and builds the archive bytes. */
export async function exportProject(name: string, snapshot: ProjectSnapshot): Promise<{ bytes: Uint8Array; missingPlugins: string[]; bundledExtensions: string[] }> {
  const plugins: ContentPluginPackage[] = [];
  const missingPlugins: string[] = [];
  for (const hash of referencedPluginHashes(snapshot)) {
    if (isBuiltin(hash)) continue;
    await resolve(hash);
    const pkg = getPackage(hash);
    if (pkg) plugins.push(pkg);
    else missingPlugins.push(hash);
  }
  const bundles: CachedBundle[] = [];
  for (const r of snapshot.requires ?? []) {
    const b = await getBundle(r.id, r.version).catch(() => null);
    if (b) bundles.push(b);
  }
  return { bytes: buildProjectArchive({ name, snapshot, plugins, bundles }), missingPlugins, bundledExtensions: bundles.map(b => b.key) };
}

/** Triggers a browser download. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Result of reading an archive into this client. */
export interface ImportedArchive {
  name: string;
  snapshot: ProjectSnapshot;
  /** Plugins that could not be verified (hash → reason). */
  pluginErrors: Record<string, string>;
  /** Extension bundles now in the local cache (`id@version`). */
  cachedExtensions: string[];
}

/** Verifies plugins, caches bundles; does not create the project yet. */
export async function importArchive(bytes: Uint8Array): Promise<ImportedArchive> {
  const contents = readProjectArchive(bytes);
  const pluginErrors: Record<string, string> = {};
  for (const file of contents.plugins) {
    const res = await importPluginFile(JSON.stringify(file));
    if (!res.ok) pluginErrors[file.hash] = res.error;
  }
  for (const b of contents.bundles) await cacheBundle(b);
  return {
    name: contents.project.name,
    snapshot: contents.project.snapshot,
    pluginErrors,
    cachedExtensions: contents.bundles.map(b => b.key),
  };
}
