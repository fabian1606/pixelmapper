/**
 * Version-history hover preview UI (happy-dom): hover/focus for 300 ms shows
 * the card with the SVG schematic and caption, leaving hides it and cancels
 * the pending load, touch devices toggle with the eye button. Tested on the
 * panel directly (reka popovers misbehave in happy-dom); the WebGL renderer
 * is bypassed with `renderer: 'svg'`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref, shallowRef } from 'vue';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import type { VersionHistory } from '~/utils/sync/version-history-controller';
import { clearVersionPreviewCache, createVersionPreview } from '~/utils/sync/version-preview/preview-controller';
import VersionHistoryPanel from './VersionHistoryPanel.vue';
import VersionPreviewCard from './VersionPreviewCard.vue';

const NOW = Date.parse('2026-10-18T12:00:00Z');

/** List entry with defaults. */
function entry(seq: number): SnapshotListEntry {
  return {
    id: `s-${seq}`, sequenceNumber: seq, label: null, createdAt: '2026-10-18T11:00:00Z',
    createdBy: 'u1', authorName: 'Ada', summary: { fixtures: 2, groups: 1, modifiers: 0 },
  };
}

const body = (id: string) => ({
  snapshotId: id,
  layout: { fixtures: [[0.5, 0.5, 1, 1, 0, '#ff0000', 0, 1, 0], [0.6, 0.5, 2, 1, 0, null, 1, 4, 0]], groups: [['Truss']], total: 2, truncated: false },
});

/** Fake history with two entries. */
function history(): VersionHistory {
  return {
    entries: shallowRef([entry(9), entry(8)]), nextCursor: ref(null), loaded: ref(true), loading: ref(false),
    loadingMore: ref(false), error: ref(null), stale: ref(false), role: ref(undefined), restoringId: ref(null),
    canRestore: computed(() => true), refresh: async () => {}, loadMore: async () => {}, restore: async () => 'restored',
  } as unknown as VersionHistory;
}

/** Preview loader whose requests resolve when `release()` is called. */
function loader() {
  let release: () => void = () => {};
  let gate = new Promise<void>((r) => { release = r; });
  const invoke = vi.fn(async (_name: string, opts?: { body?: Record<string, unknown>; signal?: AbortSignal }) => {
    await gate;
    return { data: body(String(opts?.body?.snapshotId)), error: null };
  });
  const client: RemoteClient = { functions: { invoke } };
  return {
    preview: createVersionPreview({ projectId: 'p', client: () => client, online: ref(true) }),
    invoke,
    release: () => { release(); gate = Promise.resolve(); },
  };
}

/** `(hover: hover)` media query result for the next mount. */
function stubHover(canHover: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('hover: hover') ? canHover : false, media: q, addEventListener() {}, removeEventListener() {} }));
}

/** Mounts the panel with previews (SVG renderer). */
function mountPanel(preview: ReturnType<typeof loader>['preview']) {
  return mount(VersionHistoryPanel, {
    props: { history: history(), local: false, now: NOW, preview, previewRenderer: 'svg' },
    attachTo: document.body,
  });
}

beforeEach(() => {
  reportNetworkSuccess();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearVersionPreviewCache();
  document.body.innerHTML = '';
});

describe('version preview (hover devices)', () => {
  beforeEach(() => stubHover(true));

  it('shows the card after 300 ms of hover, renders SVG + caption, hides on leave', async () => {
    const { preview, invoke, release } = loader();
    const w = mountPanel(preview);
    const item = w.findAll('[data-testid="version-history-item"]')[0]!;
    expect(w.find('[data-testid="version-preview-button"]').exists()).toBe(false);

    await item.trigger('pointerenter');
    vi.advanceTimersByTime(299);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flushPromises();
    const card = w.get('[data-testid="version-preview-card"]');
    expect(card.text()).toContain('Autosave');
    expect(card.text()).toContain('2 fixtures');
    expect(invoke).toHaveBeenCalledTimes(1);

    release();
    await flushPromises();
    const svg = w.get('[data-testid="version-preview-svg"]');
    expect(svg.findAll('ellipse')).toHaveLength(1);
    expect(svg.findAll('circle')).toHaveLength(4);
    expect(w.get('[data-testid="version-preview-card"]').attributes('data-render-mode')).toBe('svg');
    expect(w.get('[data-testid="version-preview-card"]').attributes('data-render-ms')).toBeDefined();

    await item.trigger('pointerleave');
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);
  });

  it('leaving while loading aborts the request; a cached preview shows instantly', async () => {
    const { preview, invoke, release } = loader();
    const w = mountPanel(preview);
    const [first, second] = w.findAll('[data-testid="version-history-item"]');

    await first!.trigger('pointerenter');
    vi.advanceTimersByTime(300);
    await flushPromises();
    await first!.trigger('pointerleave');
    vi.advanceTimersByTime(200);
    await flushPromises();
    expect(invoke.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);

    // Second entry: load completes and is cached.
    release();
    await second!.trigger('pointerenter');
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-svg"]').exists()).toBe(true);
    await second!.trigger('pointerleave');
    vi.advanceTimersByTime(200);
    await flushPromises();
    await second!.trigger('pointerenter');
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-svg"]').exists()).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('keyboard focus shows the preview too', async () => {
    const { preview, release } = loader();
    release();
    const w = mountPanel(preview);
    await w.findAll('[data-testid="version-history-item"]')[1]!.trigger('focusin');
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(w.get('[data-testid="version-preview-card"]').attributes('aria-label')).toContain('Preview of the version');
  });
});

describe('version preview (touch devices)', () => {
  beforeEach(() => stubHover(false));

  it('the eye button toggles the preview; pointer hover is ignored', async () => {
    const { preview, release } = loader();
    release();
    const w = mountPanel(preview);
    const item = w.findAll('[data-testid="version-history-item"]')[0]!;
    await item.trigger('pointerenter');
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);

    const button = item.get('[data-testid="version-preview-button"]');
    await button.trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(true);
    expect(button.attributes('aria-pressed')).toBe('true');
    await button.trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="version-preview-card"]').exists()).toBe(false);
  });
});

describe('VersionPreviewCard', () => {
  it('offline and empty states', async () => {
    const offline = createVersionPreview({ projectId: 'p', client: () => null, online: ref(false) });
    const w = mount(VersionPreviewCard, { props: { preview: offline, entry: entry(1), now: NOW, renderer: 'svg' } });
    await flushPromises();
    expect(w.find('[data-testid="version-preview-offline"]').exists()).toBe(true);

    const invoke = vi.fn(async () => ({ data: { snapshotId: 's-2', layout: { fixtures: [], groups: [], total: 0, truncated: false } }, error: null }));
    const empty = createVersionPreview({ projectId: 'p', client: () => ({ functions: { invoke } }), online: ref(true) });
    const e = mount(VersionPreviewCard, { props: { preview: empty, entry: entry(2), now: NOW, renderer: 'svg' } });
    await flushPromises();
    expect(e.text()).toContain('Empty project');
  });
});
