// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentAccountId, resetCurrentAccount } from '~/utils/auth/current-account';
import { createAccountEventHandler } from './account-events';
import { createLoginTracker } from './login-transition';

/** Auth stub whose persisted session belongs to `userId` (or nothing). */
function auth(userId: string | null) {
  const stored = userId ? JSON.stringify({ access_token: 'expired', user: { id: userId, email: `${userId}@x.de` } }) : null;
  return { storageKey: 'sb-key', storage: { getItem: async () => stored } };
}

/** Handler with spies for every reaction. */
function setup(cachedUser: string | null = null) {
  const deps = {
    auth: auth(cachedUser),
    tracker: createLoginTracker(null),
    rememberAccount: vi.fn(),
    onSignedIn: vi.fn(),
    setMirrorUser: vi.fn(),
    closeOpenProject: vi.fn(async () => {}),
    onSignedOut: vi.fn(),
  };
  return { deps, handler: createAccountEventHandler(deps) };
}

const session = (id: string) => ({ user: { id, email: `${id}@x.de` } });

beforeEach(() => resetCurrentAccount());

describe('account events', () => {
  it('offline boot without session: uses the cached account and starts mirroring (no sign-out)', async () => {
    const { deps, handler } = setup('user-a');
    await handler.handle('INITIAL_SESSION', null);
    expect(getCurrentAccountId()).toBe('user-a');
    expect(deps.setMirrorUser).toHaveBeenLastCalledWith('user-a');
    expect(deps.closeOpenProject).not.toHaveBeenCalled();
    expect(deps.onSignedOut).not.toHaveBeenCalled();
  });

  it('SIGNED_OUT closes the open project and stops mirroring', async () => {
    const { deps, handler } = setup();
    await handler.handle('INITIAL_SESSION', session('user-a'));
    handler.note('SIGNED_OUT', null);
    // Published synchronously, before the deferred handling.
    expect(getCurrentAccountId()).toBeNull();
    await handler.handle('SIGNED_OUT', null);
    expect(deps.closeOpenProject).toHaveBeenCalledTimes(1);
    expect(deps.setMirrorUser).toHaveBeenLastCalledWith(null);
    expect(deps.onSignedOut).toHaveBeenCalled();
  });

  it('an account switch closes the open project before the new account starts', async () => {
    const { deps, handler } = setup();
    await handler.handle('INITIAL_SESSION', session('user-a'));
    expect(deps.closeOpenProject).not.toHaveBeenCalled();
    await handler.handle('SIGNED_IN', session('user-b'));
    expect(deps.closeOpenProject).toHaveBeenCalledTimes(1);
    expect(deps.setMirrorUser.mock.calls.map(c => c[0])).toEqual(['user-a', null, 'user-b']);
    expect(deps.onSignedIn).toHaveBeenLastCalledWith({ id: 'user-b', label: 'user-b@x.de' });
  });

  it('token refreshes of the same account change nothing', async () => {
    const { deps, handler } = setup();
    await handler.handle('INITIAL_SESSION', session('user-a'));
    await handler.handle('TOKEN_REFRESHED', session('user-a'));
    expect(deps.closeOpenProject).not.toHaveBeenCalled();
    expect(deps.onSignedIn).toHaveBeenCalledTimes(1);
  });
});
