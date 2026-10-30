/**
 * Restore confirmation in the sync indicator: confirming the AlertDialog must
 * reach the version-history controller. Regression: reka's AlertDialogAction
 * closes the dialog (v-model → entry cleared) before our click handler ran,
 * so the restore was silently skipped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref, shallowRef } from 'vue';
import { setSyncStatus } from '~/utils/sync/project-sync-service';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';

// ── Fake controller (no network) ─────────────────────────────────────────────

const ENTRY: SnapshotListEntry = {
  id: 's-1', sequenceNumber: 1, label: null, createdAt: '2026-10-18T11:00:00Z',
  createdBy: 'u1', authorName: 'Ada', summary: { fixtures: 8, groups: 1, modifiers: 3 },
};
const restore = vi.fn(async () => 'restored' as const);

vi.mock('~/composables/sync/use-version-history', () => ({
  useVersionHistory: () => computed(() => ({
    entries: shallowRef([ENTRY]),
    nextCursor: ref(null),
    loaded: ref(true),
    loading: ref(false),
    loadingMore: ref(false),
    error: ref(null),
    stale: ref(false),
    role: ref('owner'),
    restoringId: ref(null),
    canRestore: computed(() => true),
    refresh: async () => {},
    loadMore: async () => {},
    restore,
  })),
}));

afterEach(() => {
  setSyncStatus({ state: 'synced', pending: 0, lastSyncedAt: null, error: undefined });
  document.body.innerHTML = '';
  restore.mockClear();
});

describe('SyncStatusIndicator restore', () => {
  it('confirming the dialog calls restore with the chosen entry', async () => {
    setSyncStatus({ state: 'synced', pending: 0, lastSyncedAt: Date.now() });
    const { default: SyncStatusIndicator } = await import('./SyncStatusIndicator.vue');
    const w = mount(SyncStatusIndicator, { props: { projectId: 'p1' }, attachTo: document.body });
    await flushPromises();

    // Open the popover and request the restore.
    (document.querySelector('[aria-haspopup="dialog"], button') as HTMLElement).click();
    await flushPromises();
    const restoreBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Restore');
    expect(restoreBtn, 'restore button in the popover').toBeTruthy();
    restoreBtn!.click();
    await flushPromises();

    // Confirm in the AlertDialog.
    const confirm = document.querySelector('[data-testid="version-restore-confirm"]') as HTMLElement | null;
    expect(confirm, 'confirmation dialog').toBeTruthy();
    confirm!.click();
    await flushPromises();

    expect(restore).toHaveBeenCalledWith(ENTRY);
    w.unmount();
  });
});
