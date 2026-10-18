/**
 * Client-side id generation (ADR 0004 D6).
 *
 * Every persisted entity (groups, presets, fixtures, changes) gets a UUID so
 * ids created on different clients — possibly while offline — never collide.
 * Ids are opaque strings: no code may parse them. A human-readable prefix
 * (`group-`, `preset-`, …) is allowed for debugging only.
 */

// ── UUID ─────────────────────────────────────────────────────────────────────

/**
 * RFC 4122 v4 UUID. Uses `crypto.randomUUID()` when available (secure
 * contexts) and falls back to `crypto.getRandomValues()` otherwise, so plain
 * `http://` LAN origins still get collision-free ids.
 */
export function newUuid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  // Fallback: build a v4 UUID from 16 random bytes.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // Last resort (no Web Crypto at all) — not cryptographically strong, but
    // still 122 random bits, which is enough to avoid accidental collisions.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID with a readable prefix, e.g. `group-0b6f…`. The prefix carries no meaning. */
export function newPrefixedId(prefix: string): string {
  return `${prefix}-${newUuid()}`;
}
