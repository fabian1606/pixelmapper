import { beforeEach, describe, expect, it } from 'vitest';
import { accountLabel, identityFromUser, readKnownAccounts, rememberAccount } from './known-accounts';

// ── identityFromUser ─────────────────────────────────────────────────────────

describe('identityFromUser', () => {
  it('reads JWT claims (sub + email)', () => {
    expect(identityFromUser({ sub: 'u1', email: 'a@b.c' })).toEqual({ id: 'u1', label: 'a@b.c' });
  });

  it('reads a User object (id) and falls back to the display name', () => {
    expect(identityFromUser({ id: 'u2', email: '', user_metadata: { display_name: 'Ann' } }))
      .toEqual({ id: 'u2', label: 'Ann' });
  });

  it('prefers sub over id and returns a null label when nothing is known', () => {
    expect(identityFromUser({ sub: 'u3', id: 'x' })).toEqual({ id: 'u3', label: null });
  });

  it.each([null, undefined, 'u1', 42, {}, { id: 5 }])('returns null for %o', (user) => {
    expect(identityFromUser(user)).toBeNull();
  });
});

// ── Known accounts ───────────────────────────────────────────────────────────

describe('rememberAccount / accountLabel', () => {
  beforeEach(() => localStorage.clear());

  it('remembers labels per account id', () => {
    rememberAccount({ id: 'u1', label: 'one@x.y' });
    rememberAccount({ id: 'u2', label: 'two@x.y' });
    expect(accountLabel('u1')).toBe('one@x.y');
    expect(accountLabel('u2')).toBe('two@x.y');
    expect(accountLabel('u3')).toBeNull();
  });

  it('updates a changed label and ignores accounts without one', () => {
    rememberAccount({ id: 'u1', label: 'old' });
    rememberAccount({ id: 'u1', label: 'new' });
    rememberAccount({ id: 'u2', label: null });
    expect(readKnownAccounts()).toEqual({ u1: 'new' });
  });

  it('treats corrupt or non-object storage as empty and recovers on write', () => {
    localStorage.setItem('pm:known-accounts', '{not json');
    expect(readKnownAccounts()).toEqual({});
    localStorage.setItem('pm:known-accounts', '["u1"]');
    expect(readKnownAccounts()).toEqual({});
    rememberAccount({ id: 'u1', label: 'one' });
    expect(accountLabel('u1')).toBe('one');
  });
});
