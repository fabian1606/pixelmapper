/**
 * Hover preview "what is special" UI (happy-dom): the card picks the most
 * significant change, chips switch between categories, fixtures get rings,
 * presets recolour the layout, first version / no change notes, and the
 * panel keeps the card open while the pointer is on it and switches chips
 * with the arrow keys. The preview pool is mocked (static effect frames).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref, shallowRef } from 'vue';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import { clearVersionPreviewCache, createVersionPreview } from '~/utils/sync/version-preview/preview-controller';
import VersionHistoryPanel from './VersionHistoryPanel.vue';
import VersionPreviewCard from './VersionPreviewCard.vue';

vi.mock('~/utils/plugins/preview-pool', async (orig) => {
  const actual = await orig<typeof import('~/utils/plugins/preview-pool')>();
  return { ...actual, renderPoints: vi.fn(() => null), renderField: vi.fn(() => null), renderStrip: vi.fn(() => null) };
});

const NOW = Date.parse('2026-10-18T12:00:00Z');

function entry(seq: number): SnapshotListEntry {
  return {
    id: `s-${seq}`, sequenceNumber: seq, label: null, createdAt: '2026-10-18T11:00:00Z',
    createdBy: 'u1', authorName: 'Ada', summary: { fixtures: 3, groups: 0, modifiers: 1 },
  };
}

const layout = {
  fixtures: [[0.4, 0.5, 1, 1, 0, '#ff0000', 0, 1, -1], [0.5, 0.5, 1, 1, 0, null, 0, 1, -1], [0.6, 0.5, 1, 1, 0, null, 0, 1, -1]],
  groups: [], total: 3, truncated: false,
};

const modifier = {
  id: 'm1', plugin: 'sha256:unknown', signature: 'scalar', targetChannels: ['DIMMER'], targetFixtureIds: ['b'],
  blendMode: 'override', strength: 1, speed: { mode: 'time', timeMs: 1000 },
  distribution: { scope: 'across', mode: 'none', origin: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, params: {},
};

/** Highlights touching every category. */
const highlights = (previousId: string | null = 'prev') => ({
  previousId,
  categories: previousId
    ? {
        live: { added: 0, changed: 1, removed: 0 },
        effect: { added: 1, changed: 0, removed: 0 },
        preset: { added: 1, changed: 0, removed: 0 },
        fixtures: { added: 1, changed: 1, removed: 0, moved: 1, groups: 0 },
      }
    : {},
  live: {
    pages: previousId
      ? [{ status: 'changed', page: { id: 'p1', name: 'Main', columns: 10, gridSize: 10, aspectRatioW: 16, aspectRatioH: 9, backgroundColor: '#000000', widgets: [{ id: 'w1', type: 'button', gridX: 0, gridY: 0, gridW: 2, gridH: 2, label: 'Go', mapping: { type: 'none' } }] }, widgets: { added: ['w1'], changed: [], removed: [] }, sectionsChanged: false }]
      : [],
    removed: [],
  },
  effects: { items: previousId ? [{ status: 'added', modifier, changedKeys: [], before: {} }] : [], removed: [] },
  presets: {
    items: previousId ? [{ status: 'added', preset: { id: 'pr', name: 'Red wash', createdAt: '', categories: [{ type: 'color', label: '', fixtureIds: ['a'], channels: [{ channelIndex: 0, channelType: 'RED', stepValues: [255] }], modifiers: [] }] }, changedKeys: [] }] : [],
    removed: [],
  },
  fixtures: previousId ? { added: [2], changed: [1], moved: [1], removed: 0 } : { added: [], changed: [], moved: [], removed: 0 },
  fixtureIndex: { a: 0, b: 1, c: 2 },
  settings: [],
  truncated: false,
});

/** Preview loader answering with `h`. */
function loader(h: unknown = highlights()) {
  const invoke = vi.fn(async (_n: string, opts?: { body?: Record<string, unknown> }) => ({
    data: { snapshotId: String(opts?.body?.snapshotId), layout, highlights: h }, error: null,
  }));
  return { preview: createVersionPreview({ projectId: 'p', client: () => ({ functions: { invoke } }), online: ref(true) }), invoke };
}

const mountCard = (preview: ReturnType<typeof loader>['preview']) =>
  mount(VersionPreviewCard, { props: { preview, entry: entry(2), now: NOW, renderer: 'svg', compareToId: 's-1' }, attachTo: document.body });

beforeEach(() => reportNetworkSuccess());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearVersionPreviewCache();
  document.body.innerHTML = '';
});

describe('VersionPreviewCard highlights', () => {
  it('defaults to the live view and switches categories with the chips', async () => {
    const { preview, invoke } = loader();
    const w = mountCard(preview);
    await flushPromises();
    expect(invoke.mock.calls[0]![1]!.body).toMatchObject({ compareToId: 's-1' });
    const card = w.get('[data-testid="version-preview-card"]');
    expect(card.attributes('data-view')).toBe('live');
    expect(w.findAll('[role="group"] button').map(b => b.text().replace(/\s+/g, ' '))).toEqual(['Live view 1', 'Effects 1', 'Presets 1', 'Fixtures 2']);
    expect(w.find('[data-testid="version-live-preview"]').exists()).toBe(true);
    expect(w.get('[data-testid="version-preview-chip-live"]').attributes('aria-pressed')).toBe('true');

    await w.get('[data-testid="version-preview-chip-effect"]').trigger('click');
    expect(w.find('[data-testid="version-effect-preview"]').exists()).toBe(true);

    await w.get('[data-testid="version-preview-chip-preset"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="version-preview-preset-name"]').text()).toBe('Red wash');
    // Fixture "a" keeps the preset red, the others are dimmed.
    const fills = w.findAll('[data-testid="version-preview-svg"] ellipse').map(e => e.attributes('fill'));
    expect(fills).toEqual(['#ff0000', '#3f3f46', '#3f3f46']);

    await w.get('[data-testid="version-preview-chip-fixtures"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-testid="version-preview-rings"] rect').map(r => r.attributes('data-mark')).sort()).toEqual(['added', 'moved']);
    expect(w.get('[data-testid="version-preview-note"]').text()).toBe('Fixtures: 1 added · 1 moved');
  });

  it('first version shows the layout; no change says so; older servers fall back to the layout', async () => {
    const first = mountCard(loader(highlights(null)).preview);
    await flushPromises();
    expect(first.get('[data-testid="version-preview-card"]').attributes('data-view')).toBe('layout');
    expect(first.get('[data-testid="version-preview-note"]').text()).toBe('First version');
    clearVersionPreviewCache();

    const none = mountCard(loader({ ...highlights(), categories: {} }).preview);
    await flushPromises();
    expect(none.get('[data-testid="version-preview-note"]').text()).toBe('No changes to the project content.');
    clearVersionPreviewCache();

    // Older server: no `highlights` field (null parses the same way).
    const old = mountCard(loader(null).preview);
    await flushPromises();
    expect(old.get('[data-testid="version-preview-card"]').attributes('data-view')).toBe('layout');
    expect(old.find('[role="group"]').exists()).toBe(false);
    expect(old.find('[data-testid="version-preview-svg"]').exists()).toBe(true);
  });
});

describe('panel interaction', () => {
  function history(): VersionHistory {
    return {
      entries: shallowRef([entry(9), entry(8)]), nextCursor: ref(null), loaded: ref(true), loading: ref(false),
      loadingMore: ref(false), error: ref(null), stale: ref(false), role: ref(undefined), restoringId: ref(null),
      canRestore: computed(() => true), refresh: async () => {}, loadMore: async () => {}, restore: async () => 'restored',
    } as unknown as VersionHistory;
  }

  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('hover: hover'), media: q, addEventListener() {}, removeEventListener() {} }));
    vi.useFakeTimers();
  });

  it('passes the next older entry, stays open on the card and cycles chips with arrow keys', async () => {
    const { preview, invoke } = loader();
    const w = mount(VersionHistoryPanel, { props: { history: history(), local: false, now: NOW, preview, previewRenderer: 'svg' }, attachTo: document.body });
    const item = w.findAll('[data-testid="version-history-item"]')[0]!;
    await item.trigger('pointerenter');
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(invoke.mock.calls[0]![1]!.body).toMatchObject({ snapshotId: 's-9', compareToId: 's-8' });

    // Pointer moves from the entry onto the card: still shown after the grace.
    await item.trigger('pointerleave');
    await w.get('[data-testid="version-preview-card"]').trigger('pointerenter');
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(true);

    await w.get('ul').trigger('keydown', { key: 'ArrowRight' });
    expect(w.get('[data-testid="version-preview-card"]').attributes('data-view')).toBe('effect');
    await w.get('ul').trigger('keydown', { key: 'ArrowLeft' });
    await w.get('ul').trigger('keydown', { key: 'ArrowLeft' });
    expect(w.get('[data-testid="version-preview-card"]').attributes('data-view')).toBe('fixtures');

    await w.get('[data-testid="version-preview-card"]').trigger('pointerleave');
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);
  });
});
