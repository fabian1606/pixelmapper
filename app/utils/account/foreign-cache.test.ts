// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { clearForeignCopies, dropForeignCopyForOpen } from './foreign-cache';
import { cloudMeta, meta, outboxEntry } from './test-helpers';

let store: InMemoryProjectStore;
beforeEach(async () => {
  store = new InMemoryProjectStore();
  // A's copies left behind by an automatic sign-out (D16 clear skipped).
  await store.putProject(cloudMeta('a-clean', 'user-a'));
  await store.putProject(cloudMeta('a-pending', 'user-a'));
  await store.appendOutbox(outboxEntry('a-pending'));
  await store.putProject(cloudMeta('b-own', 'user-b'));
  await store.putProject(cloudMeta('unbound', 'x', { ownerUserId: null }));
  await store.putProject(meta('local'));
});

describe('clearForeignCopies', () => {
  it('removes other accounts\' synced copies and keeps unsynced ones', async () => {
    const res = await clearForeignCopies(store, 'user-b');
    expect(res.removed).toEqual(['a-clean']);
    expect(res.keptPending.map(m => m.id)).toEqual(['a-pending']);
    const ids = (await store.listProjects()).map(m => m.id).sort();
    expect(ids).toEqual(['a-pending', 'b-own', 'local', 'unbound']);
    expect(await store.countPending('a-pending')).toBe(1);
  });
});

describe('dropForeignCopyForOpen', () => {
  it('drops a foreign copy without pending rows so it opens from the server', async () => {
    expect(await dropForeignCopyForOpen(store, await store.getProject('a-clean'), 'user-b')).toBe(true);
    expect(await store.getProject('a-clean')).toBeNull();
  });

  it('keeps a foreign copy with pending rows, own copies and signed-out opens', async () => {
    expect(await dropForeignCopyForOpen(store, await store.getProject('a-pending'), 'user-b')).toBe(false);
    expect(await dropForeignCopyForOpen(store, await store.getProject('b-own'), 'user-b')).toBe(false);
    expect(await dropForeignCopyForOpen(store, await store.getProject('a-clean'), null)).toBe(false);
    expect(await store.listProjects()).toHaveLength(5);
  });
});
