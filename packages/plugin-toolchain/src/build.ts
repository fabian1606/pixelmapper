/**
 * Package pipeline: compile → instrument → transpile UI → hash.
 */
import { ASC_VERSION, compile, type Diagnostic } from './compile';
import { hashPackage } from './hash';
import { instrument } from './instrument';
import { validateManifest } from './manifest';
import { transpileUi } from './ui';
import type { ContentPluginManifest, ContentPluginPackage } from './types';

/** Version of this toolchain package. */
export const TOOLCHAIN_VERSION = '1.0.0';

/** Exact toolchain identity stored in packages; recompile-verification requires a match. */
export const TOOLCHAIN_ID = `pm-toolchain@${TOOLCHAIN_VERSION}+asc@${ASC_VERSION}`;

/** Result of `buildPackage`. */
export interface BuildResult {
  pkg: ContentPluginPackage | null;
  diagnostics: Diagnostic[];
}

/**
 * Builds a content-addressed package from a manifest and sources
 * (`modifier.ts`, optional `ui.ts` named by `manifest.ui.panel`).
 */
export async function buildPackage(manifest: ContentPluginManifest, source: Record<string, string>): Promise<BuildResult> {
  const mv = validateManifest(manifest);
  if (!mv.ok) return { pkg: null, diagnostics: mv.errors.map(message => ({ severity: 'error', message: `manifest: ${message}` })) };

  const { wasm, diagnostics } = await compile({ files: { 'modifier.ts': source['modifier.ts'] ?? '' } });
  if (!wasm) return { pkg: null, diagnostics };

  let instrumented: Uint8Array;
  try {
    instrumented = instrument(wasm).wasm;
  }
  catch (err) {
    return { pkg: null, diagnostics: [...diagnostics, { severity: 'error', message: `instrumentation failed: ${(err as Error).message}` }] };
  }

  let uiJs: string | undefined;
  if (manifest.ui) {
    const ui = transpileUi(source[manifest.ui.panel] ?? '');
    if (!ui.js) return { pkg: null, diagnostics: [...diagnostics, ...ui.errors.map(message => ({ severity: 'error' as const, message }))] };
    uiJs = ui.js;
  }

  const hash = await hashPackage(manifest, instrumented, uiJs);
  return {
    pkg: { hash, manifest, wasm: instrumented, uiJs, source: { ...source }, toolchain: TOOLCHAIN_ID },
    diagnostics,
  };
}

/**
 * Recompiles a package from its source with this toolchain and checks that
 * the hash matches (ADR §6.7: imports require source; binary-only is rejected).
 */
export async function verifyPackage(pkg: Pick<ContentPluginPackage, 'hash' | 'manifest' | 'source' | 'toolchain'>): Promise<{ ok: boolean; error?: string }> {
  if (!pkg.source?.['modifier.ts']) return { ok: false, error: 'package has no source (binary-only imports are rejected)' };
  if (pkg.toolchain !== TOOLCHAIN_ID) return { ok: false, error: `built with ${pkg.toolchain}, this app uses ${TOOLCHAIN_ID}` };
  const { pkg: rebuilt, diagnostics } = await buildPackage(pkg.manifest, pkg.source);
  if (!rebuilt) return { ok: false, error: diagnostics.map(d => d.message).join('\n') };
  return rebuilt.hash === pkg.hash ? { ok: true } : { ok: false, error: `hash mismatch: expected ${pkg.hash}, got ${rebuilt.hash}` };
}
