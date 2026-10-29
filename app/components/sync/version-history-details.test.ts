/**
 * Version-history details UI: the chevron expands an entry (aria-expanded),
 * details load lazily on first expand, error → retry, offline note. Tested
 * on the panel / item directly (reka popovers may close in happy-dom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref, shallowRef } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { clearVersionDetailsCache, createVersionDetails } from '~/utils/sync/version-details-controller';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import VersionHistoryItem from './VersionHistoryItem.vue';
import VersionHistoryPanel from './VersionHistoryPanel.vue';

const NOW = Date.parse('2026-10-18T12:00:00Z');

/** List entry with defaults. */
function entry(seq: number, label: string | null = 'Named'): SnapshotListEntry {
  return {
    id: `s-${seq}`, sequenceNumber: seq, label, createdAt: '2026-10-18T11:00:00Z',
    createdBy: 'u1', authorName: 'Ada', summary: { fixtures: 1, groups: 0, modifiers: 0 },
  };
}

/** `snapshot-details` body: fixture renamed, activity by Ada. */
const body = {
  snapshot: { id: 's-9', sequenceNumber: 9, label: null, createdAt: null, data: { sceneNodes: [{ _type: 'fixture', id: 1, name: 'Spot 1' }] } },
  previous: { id: 's-8', sequenceNumber: 8, label: null, createdAt: null, data: { sceneNodes: [{ _type: 'fixture', id: 1, name: 'Spot A' }] } },
  activity: [{ userId: 'u1', authorName: 'Ada', commandType: 'RenameNode', count: 1 }],
  restores: [],
  restoredFrom: null,
};

/** Details loader over a mock client returning `outcomes` in order. */
function loader(outcomes: { data: unknown; error: unknown }[], online = true) {
  const invoke = vi.fn(async () => outcomes.shift() ?? { data: body, error: null });
  const client: RemoteClient = { functions: { invoke } };
  return { details: createVersionDetails({ projectId: 'p', client: () => client, online: ref(online) }), invoke };
}

/** Mounts one item with a details loader. */
function mountItem(details: ReturnType<typeof loader>['details']) {
  return mount(VersionHistoryItem, {
    props: { entry: entry(9), now: NOW, canRestore: true, restoring: false, details, compareToId: 's-8' },
    attachTo: document.body,
  });
}

afterEach(() => {
  clearVersionDetailsCache();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('VersionHistoryItem details', () => {
  it('expands lazily, shows diff + activity, collapses', async () => {
    const { details, invoke } = loader([]);
    const w = mountItem(details);
    const toggle = w.get('[data-testid="version-history-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.find('[data-testid="version-history-details"]').exists()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(w.text()).toContain('Loading changes…');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('snapshot-details', { body: { projectId: 'p', snapshotId: 's-9', compareToId: 's-8' } });
    const panel = w.get('[data-testid="version-history-details"]');
    expect(panel.attributes('id')).toBe(toggle.attributes('aria-controls'));
    expect(panel.text()).toContain('Fixtures');
    expect(panel.text()).toContain('Spot 1 (was Spot A): name');
    expect(panel.text()).toContain('Ada · 1× Rename');

    await toggle.trigger('click');
    expect(w.find('[data-testid="version-history-details"]').exists()).toBe(false);
    // Re-expanding uses the cache.
    await toggle.trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('Spot 1 (was Spot A): name');
  });

  it('error state with retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('x') as Error & { context: Response };
    err.context = new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    const { details, invoke } = loader([{ data: null, error: err }]);
    const w = mountItem(details);
    await w.get('[data-testid="version-history-toggle"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="version-details-error"]').text()).toContain('Could not load the changes.');
    await w.get('[data-testid="version-details-retry"]').trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(w.text()).toContain('Spot 1');
  });

  it('offline without cache → "Details need a connection"', async () => {
    const { details } = loader([], false);
    const w = mountItem(details);
    await w.get('[data-testid="version-history-toggle"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="version-details-offline"]').text()).toBe('Details need a connection.');
  });

  it('first version', async () => {
    const { details } = loader([{ data: { ...body, previous: null, activity: [] }, error: null }]);
    const w = mountItem(details);
    await w.get('[data-testid="version-history-toggle"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('First version');
  });

  it('no chevron without a loader', () => {
    const w = mount(VersionHistoryItem, { props: { entry: entry(9), now: NOW, canRestore: true, restoring: false } });
    expect(w.find('[data-testid="version-history-toggle"]').exists()).toBe(false);
  });
});

describe('VersionHistoryPanel details', () => {
  it('compares each entry with the next older one in the list', async () => {
    const h = {
      entries: shallowRef([entry(9), entry(8)]), nextCursor: ref(null), loaded: ref(true), loading: ref(false),
      loadingMore: ref(false), error: ref(null), stale: ref(false), role: ref(undefined), restoringId: ref(null),
      canRestore: computed(() => true), refresh: async () => {}, loadMore: async () => {}, restore: async () => 'restored',
    } as unknown as VersionHistory;
    const { details, invoke } = loader([]);
    const w = mount(VersionHistoryPanel, { props: { history: h, local: false, now: NOW, details } });
    const toggles = w.findAll('[data-testid="version-history-toggle"]');
    await toggles[0]!.trigger('click');
    await toggles[1]!.trigger('click');
    await flushPromises();
    expect(invoke.mock.calls.map(c => (c as unknown[])[1])).toEqual([
      { body: { projectId: 'p', snapshotId: 's-9', compareToId: 's-8' } },
      { body: { projectId: 'p', snapshotId: 's-8' } },
    ]);
  });
});
