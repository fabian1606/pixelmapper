import { isPlainObject } from '~/utils/sync/merge/values';

/**
 * Content hash of a serialized project (`ProjectSnapshot` JSON), used to
 * skip server autosaves that would not change anything (WP-SERVER
 * "Snapshot retention" › no-change autosaves).
 *
 * Normalization = the server's `snapshot_content_normalize` (migration 013)
 * and what the version diff ignores (`version-diff/settings.ts`, `scene.ts`):
 *   - the top-level `clockEpoch` is dropped (rewritten on every save);
 *   - `expanded` is dropped from every group of the `sceneNodes` tree, at any
 *     depth (a group = `_type: 'group'` or a `children` array).
 * Everything else is content. The JSON is then serialized canonically
 * (object keys sorted, `undefined` dropped as in JSON.stringify) and hashed
 * with SHA-256.
 *
 * The JS hash is only compared with other JS hashes (the last snapshot this
 * session saved); its bytes are NOT meant to match the server's
 * `content_hash` (jsonb text formatting differs from JSON.stringify).
 */

/** Removes `expanded` from the groups of a sceneNodes array (recursive, copy). */
function stripGroupUi(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((node) => {
    if (!isPlainObject(node)) return node;
    const isGroup = node._type === 'group' || Array.isArray(node.children);
    if (!isGroup) return node;
    const { expanded: _expanded, ...rest } = node;
    return Array.isArray(rest.children) ? { ...rest, children: stripGroupUi(rest.children) } : rest;
  });
}

/** Snapshot without its volatile fields (input is not mutated). */
export function normalizeSnapshotContent(snapshot: unknown): unknown {
  if (!isPlainObject(snapshot)) return snapshot;
  const { clockEpoch: _clockEpoch, ...rest } = snapshot;
  return 'sceneNodes' in rest ? { ...rest, sceneNodes: stripGroupUi(rest.sceneNodes) } : rest;
}

/** Recursively sorts object keys of plain JSON (output of JSON.parse). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}

/** Canonical JSON text: JSON.stringify semantics, keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value);
  // `undefined` / functions at the top level stringify to undefined.
  if (text === undefined) return 'null';
  return JSON.stringify(sortKeys(JSON.parse(text)));
}

/** Lower-case hex SHA-256 of the normalized, canonical snapshot. */
export async function snapshotContentHash(snapshot: unknown): Promise<string> {
  // JSON round trip first: plain data (no proxies, toJSON applied), as sent.
  const text = JSON.stringify(snapshot);
  const plain: unknown = text === undefined ? null : JSON.parse(text);
  const bytes = new TextEncoder().encode(canonicalJson(normalizeSnapshotContent(plain)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Per-session memory of the last snapshot saved to the server. One instance
 * per open project session (created in `wirePersistence`), so a reload or a
 * project switch starts without a remembered hash and always saves once.
 */
export interface SnapshotSaveDedupe {
  /** Hash of `snapshot` and whether it equals the last saved one. */
  check(snapshot: unknown): Promise<{ hash: string; unchanged: boolean }>;
  /** Records a successful save of content with `hash`. */
  saved(hash: string): void;
}

/** Creates an empty dedupe memory (nothing saved yet). */
export function createSnapshotSaveDedupe(): SnapshotSaveDedupe {
  let lastSaved: string | null = null;
  return {
    async check(snapshot) {
      try {
        const hash = await snapshotContentHash(snapshot);
        return { hash, unchanged: hash === lastSaved };
      }
      catch (err) {
        // No WebCrypto (insecure context) or unserializable data: never skip.
        console.warn('[snapshot] content hash failed, saving anyway:', err);
        return { hash: '', unchanged: false };
      }
    },
    saved(hash) {
      // '' = hash unavailable: forget, so the next save is not skipped.
      lastSaved = hash || null;
    },
  };
}
