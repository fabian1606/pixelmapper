/**
 * Plugin import (plan P4.4, ADR §6.7).
 *
 * References: a content hash (`sha256:<hex>` or bare hex), an alias
 * (`@scope/name`, newest readable version) or any link containing a hash.
 * Files: `.pmplugin.json` exports (manifest + source + toolchain + hash; the
 * binary is never trusted — the package is recompiled and must reproduce the
 * hash). Imported packages are cached and become available for the stack.
 */
import type { ContentPluginManifest, ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { BUILTIN_BY_ALIAS } from './builtin-index';
import { getPackage, getRemote, registerPackage, resolve, resolveErrors, type KnownPlugin } from './plugin-store';

/** A parsed import reference. */
export type PluginRef = { kind: 'hash'; hash: string } | { kind: 'alias'; alias: string };

const HASH_RE = /(?:sha256:)?([0-9a-f]{64})/i;
const ALIAS_RE = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

/** Parses user input (hash, alias or link); null when unrecognized. */
export function parsePluginRef(input: string): PluginRef | null {
  const text = input.trim();
  if (ALIAS_RE.test(text)) return { kind: 'alias', alias: text };
  const m = HASH_RE.exec(text);
  return m ? { kind: 'hash', hash: `sha256:${m[1]!.toLowerCase()}` } : null;
}

/** Shareable link of a plugin (any input containing the hash imports it). */
export function pluginLink(hash: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return `${origin}/plugins/${hash.replace(/^sha256:/, '')}`;
}

/** Outcome of an import. */
export type ImportResult = { ok: true; plugin: KnownPlugin } | { ok: false; error: string };

/** Imports by hash, alias or link. */
export async function importPlugin(input: string): Promise<ImportResult> {
  const ref = parsePluginRef(input);
  if (!ref) return { ok: false, error: 'Enter a plugin hash, an alias like @scope/name, or a link.' };

  let hash: string;
  if (ref.kind === 'alias') {
    const builtin = BUILTIN_BY_ALIAS[ref.alias];
    if (builtin) hash = builtin;
    else {
      const remote = getRemote();
      if (!remote) return { ok: false, error: 'Alias lookup needs a signed-in session.' };
      const rows = await remote.findByAlias(ref.alias).catch((err: Error) => {
        console.warn('[import] alias lookup failed:', err);
        return [];
      });
      if (rows.length === 0) return { ok: false, error: `No readable plugin with alias ${ref.alias}.` };
      hash = rows[0]!.hash;
    }
  }
  else hash = ref.hash;

  const plugin = await resolve(hash);
  return plugin ? { ok: true, plugin } : { ok: false, error: resolveErrors.value.get(hash) ?? 'Plugin not found.' };
}

// ── Files ────────────────────────────────────────

/** Serialized package file (no binary: it is rebuilt on import). */
export interface PluginFile {
  format: 'pixelmapper-plugin';
  version: 1;
  hash: string;
  manifest: ContentPluginManifest;
  source: Record<string, string>;
  toolchain: string;
}

/** Exports a known package as a file object (stringify for download). */
export function exportPluginFile(hash: string): PluginFile | null {
  const pkg = getPackage(hash);
  return pkg ? { format: 'pixelmapper-plugin', version: 1, hash: pkg.hash, manifest: pkg.manifest, source: pkg.source, toolchain: pkg.toolchain } : null;
}

/**
 * Imports a package file: recompiles from source with this toolchain and
 * requires the declared hash (binary-only or modified packages are rejected).
 */
export async function importPluginFile(text: string): Promise<ImportResult> {
  let file: PluginFile;
  try {
    file = JSON.parse(text) as PluginFile;
  }
  catch {
    return { ok: false, error: 'Not a plugin file (invalid JSON).' };
  }
  if (file?.format !== 'pixelmapper-plugin' || file.version !== 1 || !file.manifest || !file.hash) {
    return { ok: false, error: 'Not a pixelmapper plugin file.' };
  }
  const { buildPackage, TOOLCHAIN_ID } = await import('@pixelmapper/plugin-toolchain');
  if (file.toolchain !== TOOLCHAIN_ID) return { ok: false, error: `Built with ${file.toolchain}; this app uses ${TOOLCHAIN_ID}.` };
  const built = await buildPackage(file.manifest, file.source ?? {});
  if (!built.pkg) return { ok: false, error: built.diagnostics.map(d => d.message).join('\n') };
  if (built.pkg.hash !== file.hash) return { ok: false, error: `Hash mismatch: file says ${file.hash}, source builds ${built.pkg.hash}.` };
  const pkg: ContentPluginPackage = built.pkg;
  registerPackage(pkg);
  return { ok: true, plugin: { hash: pkg.hash, manifest: pkg.manifest, builtin: false, wasm: pkg.wasm, pkg } };
}
