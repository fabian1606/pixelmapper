/**
 * Version history UI (ADR 0004 D17): the panel renders entries, collapsed
 * autosaves, notes and emits restore requests; the header indicator opens
 * the popover with status + history.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref, shallowRef } from 'vue';
import { setSyncStatus } from '~/utils/sync/project-sync-service';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import VersionHistoryPanel from './VersionHistoryPanel.vue';
import SyncStatusIndicator from './SyncStatusIndicator.vue';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-18T12:00:00Z');

/** List entry with defaults. */
function entry(seq: number, label: string | null = null): SnapshotListEntry {
  return {
    id: `s-${seq}`, sequenceNumber: seq, label, createdAt: '2026-10-18T11:00:00Z',
    createdBy: 'u1', authorName: 'Ada', summary: { fixtures: 3, groups: 1, modifiers: 2 },
  };
}

/** Hand-made controller state (no network). */
function fakeHistory(entries: SnapshotListEntry[], over: { canRestore?: boolean; nextCursor?: string | null; role?: 'viewer' } = {}) {
  let refreshed = 0;
  const h = {
    entries: shallowRef(entries),
    nextCursor: ref(over.nextCursor ?? null),
    loaded: ref(true),
    loading: ref(false),
    loadingMore: ref(false),
    error: ref<string | null>(null),
    stale: ref(false),
    role: ref(over.role),
    restoringId: ref<string | null>(null),
    canRestore: computed(() => over.canRestore ?? true),
    refresh: async () => { refreshed++; },
    loadMore: async () => {},
    restore: async () => 'restored' as const,
  } as unknown as VersionHistory;
  return { h, refreshed: () => refreshed };
}

afterEach(() => {
  setSyncStatus({ state: 'synced', pending: 0, lastSyncedAt: null, error: undefined });
  document.body.innerHTML = '';
});

// ── Panel ────────────────────────────────────────────────────────────────────

describe('VersionHistoryPanel', () => {
  it('shows the local-project message', () => {
    const w = mount(VersionHistoryPanel, { props: { history: null, local: true, now: NOW } });
    expect(w.text()).toContain('Local project — no version history.');
  });

  it('renders entries with badge, author and summary and refreshes on mount', async () => {
    const { h, refreshed } = fakeHistory([entry(9, 'Uploaded'), entry(8, 'before offline sync')]);
    const w = mount(VersionHistoryPanel, { props: { history: h, local: false, now: NOW } });
    await flushPromises();
    expect(refreshed()).toBe(1);
    const items = w.findAll('[data-testid="version-history-item"]');
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain('Uploaded');
    expect(items[0]!.text()).toContain('1 h ago');
    expect(items[0]!.text()).toContain('Ada');
    expect(items[0]!.text()).toContain('3 fixtures · 1 group · 2 modifiers');
    expect(items[1]!.text()).toContain('Before offline sync');
  });

  it('collapses autosave runs and expands them on click', async () => {
    const { h } = fakeHistory([entry(9), entry(8), entry(7), entry(6)]);
    const w = mount(VersionHistoryPanel, { props: { history: h, local: false, now: NOW } });
    expect(w.findAll('[data-testid="version-history-item"]')).toHaveLength(1);
    await w.get('[data-testid="version-history-expand"]').trigger('click');
    expect(w.findAll('[data-testid="version-history-item"]')).toHaveLength(4);
  });

  it('emits restore requests and disables restore when not allowed', async () => {
    const allowed = fakeHistory([entry(9, 'Uploaded')]);
    const w = mount(VersionHistoryPanel, { props: { history: allowed.h, local: false, now: NOW } });
    await w.get('[data-testid="version-history-item"] button').trigger('click');
    expect(w.emitted('restore')?.[0]?.[0]).toMatchObject({ id: 's-9' });

    const viewer = fakeHistory([entry(9, 'Uploaded')], { canRestore: false, role: 'viewer' });
    const v = mount(VersionHistoryPanel, { props: { history: viewer.h, local: false, now: NOW } });
    expect(v.get('[data-testid="version-history-item"] button').attributes('disabled')).toBeDefined();
    expect(v.text()).toContain('Viewers can’t restore versions.');
  });

  it('shows "Load more" while older pages exist', () => {
    const { h } = fakeHistory([entry(9, 'Uploaded')], { nextCursor: 'c1' });
    const w = mount(VersionHistoryPanel, { props: { history: h, local: false, now: NOW } });
    expect(w.find('[data-testid="version-history-more"]').exists()).toBe(true);
  });
});

// ── Indicator ────────────────────────────────────────────────────────────────

/**
 * Mounts the indicator and clicks it. The popover content is read right
 * after the click: happy-dom's focus handling closes reka's dismissable
 * layer on the next tick, which a real browser does not.
 */
async function openIndicator(): Promise<{ text: string; inline: string; unmount: () => void }> {
  const w = mount(SyncStatusIndicator, { props: { projectId: 'p1' }, attachTo: document.body });
  await flushPromises();
  const inline = w.text();
  await w.get('[data-testid="sync-status-indicator"]').trigger('click');
  const text = document.body.querySelector('[data-testid="sync-status-popover"]')?.textContent ?? '';
  return { text, inline, unmount: () => w.unmount() };
}

describe('SyncStatusIndicator', () => {
  it('opens a popover with status and the local-project note', async () => {
    setSyncStatus({ state: 'local-only', pending: 0, lastSyncedAt: null });
    const r = await openIndicator();
    expect(r.text).toContain('Local only');
    expect(r.text).toContain('Local project — no version history.');
    r.unmount();
  });

  it('shows the pending count while offline', async () => {
    setSyncStatus({ state: 'offline', pending: 3, lastSyncedAt: NOW });
    const r = await openIndicator();
    expect(r.inline).toContain('3 pending');
    expect(r.text).toContain('Offline · 3 pending');
    expect(r.text).toContain('Version history');
    r.unmount();
  });
});

