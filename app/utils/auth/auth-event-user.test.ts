// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveAuthEventUser } from '~/utils/auth/auth-event-user';

/** Auth stub whose storage holds `stored` under its storage key. */
function authWith(stored: unknown) {
  return {
    storageKey: 'sb-test-auth-token',
    storage: { getItem: async () => (stored == null ? null : JSON.stringify(stored)) },
  };
}

const cached = { access_token: 'expired', user: { id: 'user-a', email: 'a@x.de' } };

describe('resolveAuthEventUser', () => {
  it('uses the event session when present', async () => {
    const u = await resolveAuthEventUser('SIGNED_IN', { user: { id: 'user-b', email: 'b@x.de' } }, authWith(cached));
    expect(u).toEqual({ id: 'user-b', email: 'b@x.de' });
  });

  it('falls back to the cached session on an offline INITIAL_SESSION without session', async () => {
    expect(await resolveAuthEventUser('INITIAL_SESSION', null, authWith(cached))).toEqual({ id: 'user-a', email: 'a@x.de' });
  });

  it('treats SIGNED_OUT as signed out even if a session is still stored', async () => {
    expect(await resolveAuthEventUser('SIGNED_OUT', null, authWith(cached))).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    expect(await resolveAuthEventUser('INITIAL_SESSION', null, authWith(null))).toBeNull();
  });
});
