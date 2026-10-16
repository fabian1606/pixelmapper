/**
 * Content addressing (ADR D8, §6.1). Lightweight subpath export
 * (`@pixelmapper/plugin-toolchain/hash`); uses WebCrypto (Bun + browser).
 *
 * hash = sha256( canonical(manifest) ‖ wasm ‖ uiJs? ), where canonical(manifest)
 * is JSON with recursively sorted keys, no whitespace and no `hash` field.
 */
import type { ContentPluginManifest } from './types';

/** Recursively sorts object keys (arrays keep their order). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'hash') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON of a manifest. */
export function canonicalManifest(manifest: ContentPluginManifest): string {
  return JSON.stringify(sortKeys(manifest));
}

/** Lower-case hex of bytes. */
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Computes `sha256:<hex>` for a package. */
export async function hashPackage(manifest: ContentPluginManifest, wasm: Uint8Array, uiJs?: string): Promise<string> {
  const enc = new TextEncoder();
  const parts = [enc.encode(canonicalManifest(manifest)), wasm, ...(uiJs !== undefined ? [enc.encode(uiJs)] : [])];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return `sha256:${hex(await globalThis.crypto.subtle.digest('SHA-256', buf))}`;
}
