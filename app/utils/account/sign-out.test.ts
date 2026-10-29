// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_ACCOUNT_POLICY, WEB_ACCOUNT_POLICY, type AccountPolicy } from '~/platform/account-policy';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import { endSession, finishSignOut, flushBeforeSignOut, type SignOutAuth, type SignOutDeps } from './sign-out';
import { cloudMeta, fakeSync, meta, outboxEntry } from './test-helpers';

// ── Harness ──────────────────────────────────────────────────────────────────

/** Fake record hooks (1 pending record by default). */
function fakeRecords(pending = 1) {
  return {
    syncAllRecords: vi.fn(async () => {}),
    countPendingRecords: vi.fn(async (_userId: string) => pending),
    clearLocalRecords: vi.fn(async () => {}),
  };
}

/** Fake `supabase.auth` with a `_removeSession` fallback. */
function fakeAuth(signOut: SignOutAuth['signOut'] = async () => ({ error: null })) {
  return { signOut: vi.fn(signOut), _removeSession: vi.fn(async () => {}) };
}

let store: InMemoryProjectStore;

/** Deps with the given policy / sync service. */
function deps(policy: AccountPolicy, sync: ProjectSyncService | null = fakeSync()) {
  const records = fakeRecords();
  const auth = fakeAuth();
  const d: SignOutDeps = { policy, store, sync, records, auth };
  return { d, records, auth };
}

beforeEach(async () => {
  store = new InMemoryProjectStore();
  await store.putProject(meta('local'));
  await store.putProject(cloudMeta('mine', 'u1'));
  await store.putProject(cloudMeta('theirs', 'u2'));
  await store.appendOutbox(outboxEntry('mine'));
  await store.appendOutbox(outboxEntry('mine'));
  await store.appendOutbox(outboxEntry('theirs'));
  await store.appendOutbox(outboxEntry('local'));
});

// ── flushBeforeSignOut ───────────────────────────────────────────────────────

describe('flushBeforeSignOut', () => {
  it('flushes through the sync service and syncs records', async () => {
    const sync = fakeSync({ flushAll: vi.fn(async () => 4) });
    const { d, records } = deps(WEB_ACCOUNT_POLICY, sync);
    expect(await flushBeforeSignOut(d, 'u1')).toEqual({ projects: 4, records: 1 });
    expect(sync.flushAll).toHaveBeenCalledWith('u1');
    expect(records.syncAllRecords).toHaveBeenCalled();
    expect(records.countPendingRecords).toHaveBeenCalledWith('u1');
  });

  it('web adopts local-only records before syncing (the clear would delete them); desktop does not', async () => {
    const web = deps(WEB_ACCOUNT_POLICY);
    const adoptWeb = vi.fn(async (_u: string) => 1);
    web.d.records = { ...web.records, adoptLocalRecords: adoptWeb };
    await flushBeforeSignOut(web.d, 'u1');
    expect(adoptWeb).toHaveBeenCalledWith('u1');
    expect(adoptWeb.mock.invocationCallOrder[0]!).toBeLessThan(web.records.syncAllRecords.mock.invocationCallOrder[0]!);

    const desktop = deps(DESKTOP_ACCOUNT_POLICY);
    const adoptDesktop = vi.fn(async (_u: string) => 1);
    desktop.d.records = { ...desktop.records, adoptLocalRecords: adoptDesktop };
    await flushBeforeSignOut(desktop.d, 'u1');
    expect(adoptDesktop).not.toHaveBeenCalled();
  });

  it('without a sync service counts the outbox of the account\'s cloud projects only', async () => {
    const { d } = deps(WEB_ACCOUNT_POLICY, null);
    expect((await flushBeforeSignOut(d, 'u1')).projects).toBe(2);
  });

  it('falls back to counting when the flush throws; record errors give 0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sync = fakeSync({ flushAll: vi.fn(async () => { throw new Error('boom'); }) });
    const { d, records } = deps(WEB_ACCOUNT_POLICY, sync);
    records.syncAllRecords.mockRejectedValueOnce(new Error('offline'));
    expect(await flushBeforeSignOut(d, 'u1')).toEqual({ projects: 2, records: 0 });
    warn.mockRestore();
  });
});

// ── finishSignOut ────────────────────────────────────────────────────────────

describe('finishSignOut', () => {
  it('web clears the whole store and the user records', async () => {
    const { d, records, auth } = deps(WEB_ACCOUNT_POLICY);
    await finishSignOut(d, 'u1', { keepLocalCopies: true });
    expect(await store.listProjects()).toEqual([]);
    expect(await store.countPending()).toBe(0);
    expect(records.clearLocalRecords).toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('desktop keep: nothing is deleted', async () => {
    const { d, records, auth } = deps(DESKTOP_ACCOUNT_POLICY);
    await finishSignOut(d, 'u1', { keepLocalCopies: true });
    expect((await store.listProjects()).map(m => m.id).sort()).toEqual(['local', 'mine', 'theirs']);
    expect(records.clearLocalRecords).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('tears the account session down before the cache is cleared', async () => {
    const { d } = deps(WEB_ACCOUNT_POLICY);
    const order: string[] = [];
    // The open project's writer would flush a working snapshot on close.
    d.teardown = vi.fn(async () => {
      order.push('teardown');
      await store.putWorkingSnapshot('mine', { version: 1 } as never);
    });
    const clearAll = store.clearAll.bind(store);
    store.clearAll = vi.fn(async () => { order.push('clear'); await clearAll(); });
    await finishSignOut(d, 'u1', { keepLocalCopies: true });
    expect(order).toEqual(['teardown', 'clear']);
    // Nothing of the account survives the web clear.
    expect(await store.getWorkingSnapshot('mine')).toBeNull();
  });

  it('desktop remove: only cloud copies bound to the account are deleted', async () => {
    const { d } = deps(DESKTOP_ACCOUNT_POLICY);
    await finishSignOut(d, 'u1', { keepLocalCopies: false });
    expect((await store.listProjects()).map(m => m.id).sort()).toEqual(['local', 'theirs']);
    expect(await store.countPending('mine')).toBe(0);
    expect(await store.countPending('theirs')).toBe(1);
  });
});

// ── endSession ───────────────────────────────────────────────────────────────

describe('endSession', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('signs out locally', async () => {
    const auth = fakeAuth();
    await endSession(auth);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth._removeSession).not.toHaveBeenCalled();
  });

  it('removes the stored session when signOut returns an error', async () => {
    const auth = fakeAuth(async () => ({ error: new TypeError('Failed to fetch') }));
    await endSession(auth);
    expect(auth._removeSession).toHaveBeenCalledTimes(1);
  });

  it('removes the stored session when signOut throws', async () => {
    const auth = fakeAuth(async () => { throw new Error('offline'); });
    await endSession(auth);
    expect(auth._removeSession).toHaveBeenCalledTimes(1);
  });

  it('does not fail when no fallback exists', async () => {
    const auth: SignOutAuth = { signOut: async () => ({ error: new Error('x') }) };
    await expect(endSession(auth)).resolves.toBeUndefined();
  });
});
