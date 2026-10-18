import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { resetCurrentAccount, setCurrentAccountId } from '~/utils/auth/current-account';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { mirrorHeadless } from '~/utils/sync/project-mirror';
import type { RemoteClient, RemoteProjectHead } from '~/utils/sync/remote-api';
import { makeState } from '~/utils/sync/merge/adapters/test-state';
import { appendRow } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Account safety of the headless mirror (ADR 0004 D13, D15): legacy rows
 * without an account are never bound by a background pass, and a pass that
 * outlives a sign-out writes nothing back.
 */

let server: FakeSyncServer;
let store: InMemoryProjectStore;

/** Head as `list-projects-sync` returns it. */
function head(id: string, seq: number): RemoteProjectHead {
  return {
    id, name: `Server ${id}`, description: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    role: 'owner', ownerId: 'u-me', latestSequence: seq, latestChangeAt: null, latestSnapshotSequence: seq,
  };
}

beforeEach(() => {
  reportNetworkSuccess();
  resetCurrentAccount();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
});

afterEach(() => resetCurrentAccount());

describe('mirrorHeadless', () => {
  it('leaves legacy outbox rows without meta unbound (bound on open)', async () => {
    server.addSnapshot('legacy', makeState({ globalBpm: 100 }), 2);
    // Migrated from the legacy WAL: rows, but no meta and no account.
    await appendRow(store, 'legacy', 'old-row', 'engine.bpm', { bpm: 66 }, 'live-op');

    await expect(mirrorHeadless(store, server.client, head('legacy', 2), 'u-me')).resolves.toBe(true);

    expect(await store.getProject('legacy')).toBeNull();
    expect(await store.getBaseSnapshot('legacy')).toBeNull();
    expect(await store.countPending('legacy')).toBe(1);
  });

  it('writes nothing when the account signed out during the download', async () => {
    server.addSnapshot('p', makeState({ globalBpm: 100 }), 2);
    setCurrentAccountId('u-me');
    const client: RemoteClient = {
      functions: {
        async invoke(name, options) {
          // Sign-out completes while the snapshot is downloading.
          setCurrentAccountId(null);
          return server.client.functions.invoke(name, options);
        },
      },
    };

    await mirrorHeadless(store, client, head('p', 2), 'u-me');

    expect(await store.getProject('p')).toBeNull();
    expect(await store.getWorkingSnapshot('p')).toBeNull();
  });

  it('still mirrors for the signed-in account', async () => {
    server.addSnapshot('p', makeState({ globalBpm: 100 }), 2);
    setCurrentAccountId('u-me');
    await mirrorHeadless(store, server.client, head('p', 2), 'u-me');
    expect(await store.getProject('p')).toMatchObject({ ownerUserId: 'u-me', serverCursor: 2 });
  });
});
