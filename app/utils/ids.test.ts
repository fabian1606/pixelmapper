// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newPrefixedId, newUuid } from '~/utils/ids';

/** Matches an RFC 4122 version-4 UUID. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ids', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('creates unique v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newUuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    // Simulate a non-secure context: only getRandomValues is exposed.
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    expect(newUuid()).toMatch(UUID_V4);
  });

  it('prefixes ids without changing the UUID part', () => {
    const id = newPrefixedId('group');
    expect(id.startsWith('group-')).toBe(true);
    expect(id.slice('group-'.length)).toMatch(UUID_V4);
  });
});
