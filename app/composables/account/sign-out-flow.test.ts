// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_ACCOUNT_POLICY, WEB_ACCOUNT_POLICY, type AccountPolicy } from '~/platform/account-policy';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import type { SignOutDeps } from '~/utils/account/sign-out';
import { cloudMeta, fakeSync, meta } from '~/utils/account/test-helpers';
import { createSignOutFlow } from './sign-out-flow';

// ── Harness ──────────────────────────────────────────────────────────────────

let store: InMemoryProjectStore;

/** Flow with the given policy, pending counts and signed-in account. */
function setup(opts: { policy: AccountPolicy; projects?: number; records?: number; userId?: string | null }) {
  const sync = fakeSync({ flushAll: vi.fn(async () => opts.projects ?? 0) });
  const records = {
    syncAllRecords: vi.fn(async () => {}),
    countPendingRecords: vi.fn(async () => opts.records ?? 0),
    clearLocalRecords: vi.fn(async () => {}),
  };
  const auth = { signOut: vi.fn(async () => ({ error: null })) };
  const deps: SignOutDeps = { policy: opts.policy, store, sync, records, auth };
  const onSignedOut = vi.fn();
  const flow = createSignOutFlow({
    resolve: async () => deps,
    userId: () => (opts.userId === undefined ? 'u1' : opts.userId),
    onSignedOut,
  });
  return { flow, auth, records, onSignedOut, sync };
}

/** Ids left in the store, sorted. */
async function ids(): Promise<string[]> {
  return (await store.listProjects()).map(m => m.id).sort();
}

beforeEach(async () => {
  store = new InMemoryProjectStore();
  await store.putProject(meta('local'));
  await store.putProject(cloudMeta('mine', 'u1'));
  await store.putProject(cloudMeta('theirs', 'u2'));
});

// ── Web ──────────────────────────────────────────────────────────────────────

describe('createSignOutFlow (web)', () => {
  it('finishes directly when nothing is pending', async () => {
    const { flow, auth, onSignedOut } = setup({ policy: WEB_ACCOUNT_POLICY });
    await flow.start();
    expect(flow.state.value).toEqual({ step: 'idle' });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual([]);
  });

  it('asks before losing pending changes; confirm continues', async () => {
    const { flow, auth, onSignedOut } = setup({ policy: WEB_ACCOUNT_POLICY, projects: 2, records: 1 });
    await flow.start();
    expect(flow.state.value).toEqual({ step: 'pending', pending: { projects: 2, records: 1 } });
    expect(auth.signOut).not.toHaveBeenCalled();
    await flow.confirmPending();
    expect(flow.state.value.step).toBe('idle');
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('cancel returns to idle without signing out', async () => {
    const { flow, auth, onSignedOut } = setup({ policy: WEB_ACCOUNT_POLICY, records: 1 });
    await flow.start();
    flow.cancel();
    expect(flow.state.value).toEqual({ step: 'idle' });
    await flow.confirmPending();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['local', 'mine', 'theirs']);
  });

  it('ignores start while a flow is waiting', async () => {
    const { flow, sync } = setup({ policy: WEB_ACCOUNT_POLICY, projects: 1 });
    await flow.start();
    await flow.start();
    expect(sync.flushAll).toHaveBeenCalledTimes(1);
  });
});

// ── Desktop ──────────────────────────────────────────────────────────────────

describe('createSignOutFlow (desktop)', () => {
  it('asks about bound cloud copies; remove deletes only those', async () => {
    const { flow, auth, onSignedOut } = setup({ policy: DESKTOP_ACCOUNT_POLICY });
    await flow.start();
    expect(flow.state.value).toEqual({ step: 'copies', copies: 1, pending: { projects: 0, records: 0 } });
    await flow.chooseCopies(false);
    expect(flow.state.value.step).toBe('idle');
    expect(await ids()).toEqual(['local', 'theirs']);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('keep leaves everything in place', async () => {
    const { flow, auth } = setup({ policy: DESKTOP_ACCOUNT_POLICY });
    await flow.start();
    await flow.chooseCopies(true);
    expect(await ids()).toEqual(['local', 'mine', 'theirs']);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('pending → copies → finish', async () => {
    const { flow, onSignedOut } = setup({ policy: DESKTOP_ACCOUNT_POLICY, projects: 3 });
    await flow.start();
    expect(flow.state.value.step).toBe('pending');
    await flow.confirmPending();
    expect(flow.state.value).toEqual({ step: 'copies', copies: 1, pending: { projects: 3, records: 0 } });
    await flow.chooseCopies(true);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('finishes directly without bound copies', async () => {
    await store.deleteProject('mine');
    const { flow, onSignedOut } = setup({ policy: DESKTOP_ACCOUNT_POLICY });
    await flow.start();
    expect(flow.state.value.step).toBe('idle');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual(['local', 'theirs']);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('createSignOutFlow (edge cases)', () => {
  it('signed out: just finishes without cleanup or flush', async () => {
    const { flow, auth, sync, onSignedOut } = setup({ policy: WEB_ACCOUNT_POLICY, userId: null });
    await flow.start();
    expect(flow.state.value.step).toBe('idle');
    expect(sync.flushAll).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual(['local', 'mine', 'theirs']);
  });

  it('a failing resolve returns to idle', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSignedOut = vi.fn();
    const flow = createSignOutFlow({
      resolve: async () => { throw new Error('no store'); },
      userId: () => 'u1',
      onSignedOut,
    });
    await flow.start();
    expect(flow.state.value.step).toBe('idle');
    expect(onSignedOut).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
