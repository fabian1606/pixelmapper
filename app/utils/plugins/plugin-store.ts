/**
 * Plugin store (main thread, ADR §6.10).
 *
 * Knows every content plugin the app can use, by content hash: the
 * built-ins (manifests embedded in `builtin-index.ts`, wasm served from
 * `/plugins/<hex>.wasm`) plus packages registered at runtime (created,
 * imported or received from collaborators). Plan P4.2 extends `resolve`
 * with IndexedDB and Supabase.
 */
import { shallowRef } from 'vue';
import type { ContentPluginManifest, ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { BUILTIN_PLUGINS } from './builtin-index';

/** A plugin known to this client. */
export interface KnownPlugin {
  hash: string;
  manifest: ContentPluginManifest;
  builtin: boolean;
  /** Compiled module, once loaded. */
  wasm?: Uint8Array;
  /** Full package (non-built-ins). */
  pkg?: ContentPluginPackage;
}

const plugins = new Map<string, KnownPlugin>(
  BUILTIN_PLUGINS.map(p => [p.hash, { hash: p.hash, manifest: p.manifest, builtin: true }]),
);

/** Bumped whenever plugins are added (reactive dependency for lists). */
export const pluginRevision = shallowRef(0);

/** Manifest of a known plugin (synchronous). */
export function getManifest(hash: string): ContentPluginManifest | undefined {
  return plugins.get(hash)?.manifest;
}

/** All known plugins: built-ins first, then by name. */
export function listPlugins(): KnownPlugin[] {
  void pluginRevision.value;
  return [...plugins.values()].sort((a, b) =>
    Number(b.builtin) - Number(a.builtin) || a.manifest.name.localeCompare(b.manifest.name));
}

/** True for built-in hashes. */
export function isBuiltin(hash: string): boolean {
  return plugins.get(hash)?.builtin ?? false;
}

/** Registers a package (created, imported or received). */
export function registerPackage(pkg: ContentPluginPackage): void {
  plugins.set(pkg.hash, { hash: pkg.hash, manifest: pkg.manifest, builtin: false, wasm: pkg.wasm, pkg });
  pluginRevision.value++;
}

/** URL of a built-in artifact. */
function builtinUrl(hash: string, ext: 'wasm' | 'json'): string {
  return `/plugins/${hash.replace(/^sha256:/, '')}.${ext}`;
}

/**
 * Compiled module bytes of a plugin: memory → built-in file. Returns null
 * when the plugin is unknown or cannot be fetched.
 */
export async function loadWasm(hash: string): Promise<Uint8Array | null> {
  const known = plugins.get(hash);
  if (known?.wasm) return known.wasm;
  if (!known?.builtin) return null;
  try {
    const res = await fetch(builtinUrl(hash, 'wasm'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    known.wasm = new Uint8Array(await res.arrayBuffer());
    return known.wasm;
  }
  catch (err) {
    console.error(`[plugin-store] cannot load built-in ${hash}:`, err);
    return null;
  }
}
