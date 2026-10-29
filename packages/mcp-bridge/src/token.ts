// ── Pairing token ───────────────────────────────────────
//
// A random 32-byte hex secret shared between the CLI and the app. It is
// created on first use with owner-only permissions and compared in constant
// time.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Token format: 64 lowercase hex chars. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Generates a fresh pairing token. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Reads the token from `file`, creating it (mode 0600, parent dir 0700) when
 * missing or malformed.
 */
export function loadOrCreateToken(file: string): string {
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (TOKEN_RE.test(existing)) return existing;
    console.warn(`[mcp] token file ${file} is malformed; regenerating`);
  }
  const token = generateToken();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies on creation; enforce it for rewrites too.
  chmodSync(file, 0o600);
  return token;
}

/** Constant-time comparison of a received token against the expected one. */
export function tokensEqual(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
