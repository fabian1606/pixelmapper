// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLoginTracker, type KeyValueStorage } from './login-transition';

/** Map-backed storage (persists across trackers like localStorage does across reloads). */
function mapStorage(map = new Map<string, string>()): KeyValueStorage & { map: Map<string, string> } {
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

// ── createLoginTracker ───────────────────────────────────────────────────────

describe('createLoginTracker', () => {
  it('treats the first session on an empty device as a sign-in', () => {
    const t = createLoginTracker(mapStorage());
    expect(t.observe('SIGNED_IN', 'u1')).toBe('u1');
  });

  it('does not report the same account again (refresh, repeat, initial session)', () => {
    const storage = mapStorage();
    const t = createLoginTracker(storage);
    t.observe('SIGNED_IN', 'u1');
    expect(t.observe('TOKEN_REFRESHED', 'u1')).toBeNull();
    expect(t.observe('SIGNED_IN', 'u1')).toBeNull();
    // A reload: a new tracker on the same storage.
    expect(createLoginTracker(storage).observe('INITIAL_SESSION', 'u1')).toBeNull();
  });

  it('reports an account switch', () => {
    const t = createLoginTracker(mapStorage());
    t.observe('SIGNED_IN', 'u1');
    expect(t.observe('SIGNED_IN', 'u2')).toBe('u2');
  });

  it('keeps the record when the initial session is missing (offline, expired token)', () => {
    const t = createLoginTracker(mapStorage());
    t.observe('SIGNED_IN', 'u1');
    expect(t.observe('INITIAL_SESSION', null)).toBeNull();
    expect(t.observe('INITIAL_SESSION', 'u1')).toBeNull();
  });

  it('SIGNED_OUT clears: the next session of the same account is a sign-in', () => {
    const storage = mapStorage();
    const t = createLoginTracker(storage);
    t.observe('SIGNED_IN', 'u1');
    expect(t.observe('SIGNED_OUT', null)).toBeNull();
    expect(storage.map.size).toBe(0);
    expect(t.observe('SIGNED_IN', 'u1')).toBe('u1');
  });

  it('falls back to memory when storage is missing or throws', () => {
    const memory = createLoginTracker(null);
    expect(memory.observe('SIGNED_IN', 'u1')).toBe('u1');
    expect(memory.observe('TOKEN_REFRESHED', 'u1')).toBeNull();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const t = createLoginTracker(broken);
    expect(t.observe('SIGNED_IN', 'u1')).toBe('u1');
    expect(t.observe('SIGNED_IN', 'u1')).toBeNull();
    warn.mockRestore();
  });
});
