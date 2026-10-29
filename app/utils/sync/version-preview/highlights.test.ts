// @vitest-environment node
/**
 * "What is special about this version" (migration 015 highlights): wire
 * parsing, category ranking, fixture highlight mapping, preset colours and
 * the controller's diff-base handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { parseSnapshotHighlights } from '~/utils/sync/remote-api-snapshot-highlights';
import { parseSnapshotPreviewResponse } from '~/utils/sync/remote-api-snapshot-preview';
import { categoryColor, fixtureMarks, highlightRings, MARK_COLORS, presetFixtureColors, recolorModel, UNTOUCHED_COLOR } from '~/utils/sync/version-preview/highlight-map';
import { fixturesCaption, pickDefaultView, planPreview, settingsNote } from '~/utils/sync/version-preview/highlight-ranking';
import type { SnapshotHighlights } from '~/utils/sync/version-preview/highlight-types';
import { clearVersionPreviewCache, createVersionPreview } from '~/utils/sync/version-preview/preview-controller';
import { buildPreviewModel, fitCamera } from '~/utils/sync/version-preview/preview-model';
import { presetStatusText, presetSummary } from '~/utils/sync/version-preview/preset-preview';

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';

/** Three single heads in a row. */
const layout = {
  fixtures: [[0.4, 0.5, 1, 1, 0, '#ff0000', 0, 1, -1], [0.5, 0.5, 1, 1, 0, null, 0, 1, -1], [0.6, 0.5, 1, 1, 0, null, 0, 1, -1]],
  groups: [],
  total: 3,
  truncated: false,
};

/** Wire highlights with every block filled. */
const wire = {
  previousId: 'prev',
  categories: {
    live: { added: 0, changed: 1, removed: 0 },
    effect: { added: 1, changed: 0, removed: 1 },
    preset: { added: 0, changed: 0, removed: 0 },
    fixtures: { added: 1, changed: 2, removed: 1, moved: 1, groups: 0 },
    bogus: { added: 3 },
  },
  live: {
    pages: [
      { status: 'changed', page: { id: 'p1', name: 'Main', widgets: [] }, widgets: { added: ['w1', 7], changed: [], removed: [{ id: 'w9', type: 'button', label: 'Strobe' }, { bad: 1 }] }, sectionsChanged: true },
      { status: 'weird', page: { id: 'p2', widgets: [] } },
      { status: 'added', page: { id: 'p3' } },
    ],
    removed: [{ id: 'p4', name: 'Old' }, { name: 'no id' }],
  },
  effects: {
    items: [{ status: 'added', modifier: { id: 'm1', plugin: 'sha256:a' }, changedKeys: [], before: {} }, { status: 'added', modifier: { id: 'm2' } }],
    removed: [{ id: 'm0', name: 'sha256:b' }],
  },
  presets: { items: [], removed: [] },
  fixtures: { added: [2, 99, -1, 'x'], changed: [0, 1, 1], moved: [1], removed: 1 },
  fixtureIndex: { a: 0, b: 1, c: 2, far: 50, neg: -1 },
  settings: ['globalBpm', 4],
  truncated: true,
};

/** Highlights with only the given categories (counts) set. */
function withCategories(categories: SnapshotHighlights['categories'], extra: Partial<SnapshotHighlights> = {}): SnapshotHighlights {
  return {
    previousId: 'prev',
    categories,
    live: { pages: [], removed: [] },
    effects: { items: [], removed: [] },
    presets: { items: [], removed: [] },
    fixtures: { added: [], changed: [], moved: [], removed: 0 },
    fixtureIndex: {},
    settings: [],
    truncated: false,
    ...extra,
  };
}

const counts = (added: number, changed: number, removed: number) => ({ added, changed, removed });

beforeEach(() => reportNetworkSuccess());
afterEach(() => clearVersionPreviewCache());

// ── Parsing ──────────────────────────────────────────────────────────────────

describe('highlights parsing', () => {
  it('keeps valid items, drops malformed ones and out-of-range indices', () => {
    const h = parseSnapshotHighlights(wire, 3)!;
    expect(h.previousId).toBe('prev');
    expect(Object.keys(h.categories).sort()).toEqual(['effect', 'fixtures', 'live']);
    expect(h.categories.fixtures).toEqual({ added: 1, changed: 2, removed: 1, moved: 1, groups: 0 });
    expect(h.live.pages).toHaveLength(1);
    expect(h.live.pages[0]).toMatchObject({ addedWidgets: ['w1', '7'], sectionsChanged: true, removedWidgets: [{ id: 'w9', type: 'button', label: 'Strobe' }] });
    expect(h.live.removed).toEqual([{ id: 'p4', name: 'Old' }]);
    expect(h.effects.items.map(e => e.modifier.id)).toEqual(['m1']);
    expect(h.fixtures).toEqual({ added: [2], changed: [0, 1], moved: [1], removed: 1 });
    expect(h.fixtureIndex).toEqual({ a: 0, b: 1, c: 2 });
    expect(h.settings).toEqual(['globalBpm']);
    expect(h.truncated).toBe(true);
  });

  it('older servers (no highlights) and garbage yield null; the layout still parses', () => {
    expect(parseSnapshotHighlights(undefined, 3)).toBeNull();
    expect(parseSnapshotHighlights([1], 3)).toBeNull();
    const res = parseSnapshotPreviewResponse({ snapshotId: 's', layout })!;
    expect(res.highlights).toBeNull();
    expect(res.layout.fixtures).toHaveLength(3);
    const withH = parseSnapshotPreviewResponse({ snapshotId: 's', layout, highlights: wire })!;
    expect(withH.highlights?.fixtures.added).toEqual([2]);
  });

  it('first version: no previous id', () => {
    expect(parseSnapshotHighlights({ previousId: null, categories: {} }, 0)).toMatchObject({ previousId: null, categories: {} });
  });
});

// ── Ranking ──────────────────────────────────────────────────────────────────

describe('category ranking', () => {
  it('fixed priority live > effect > preset > fixtures', () => {
    expect(pickDefaultView({ fixtures: counts(1, 0, 0), preset: counts(0, 1, 0) })).toBe('preset');
    expect(pickDefaultView({ effect: counts(0, 2, 0), preset: counts(3, 0, 0) })).toBe('effect');
    expect(pickDefaultView({ live: counts(0, 1, 0), effect: counts(5, 0, 0) })).toBe('live');
    expect(pickDefaultView({})).toBeNull();
  });

  it('a structural rig change beats minor tweaks only', () => {
    // 6 fixtures added vs. one effect param changed → fixtures.
    expect(pickDefaultView({ effect: counts(0, 1, 0), fixtures: counts(6, 0, 0) })).toBe('fixtures');
    // An added effect is not minor.
    expect(pickDefaultView({ effect: counts(1, 0, 0), fixtures: counts(6, 0, 0) })).toBe('effect');
    // Below the threshold the priority holds.
    expect(pickDefaultView({ live: counts(0, 1, 0), fixtures: counts(4, 0, 0) })).toBe('live');
    // Groups alone count as a fixtures change.
    expect(pickDefaultView({ fixtures: { ...counts(0, 0, 0), groups: 1 } })).toBe('fixtures');
  });

  it('plans chips, first version, settings only and no change', () => {
    const plan = planPreview(withCategories({ fixtures: { ...counts(1, 2, 0), groups: 1 }, effect: counts(0, 1, 0) }));
    expect(plan.chips.map(c => [c.kind, c.label, c.count])).toEqual([['effect', 'Effects', 1], ['fixtures', 'Fixtures', 4]]);
    expect(plan.view).toBe('effect');
    expect(planPreview(withCategories({}, { previousId: null }))).toMatchObject({ view: 'layout', first: true, chips: [] });
    expect(planPreview(null)).toMatchObject({ view: 'layout', first: false });
    const settings = planPreview(withCategories({ settings: counts(0, 1, 0) }, { settings: ['globalBpm', 'fooBar'] }));
    expect(settings).toMatchObject({ view: 'layout', settingsNote: 'Project settings changed: BPM, foo bar' });
    expect(planPreview(withCategories({})).view).toBe('none');
  });

  it('captions', () => {
    expect(settingsNote([])).toBe('');
    expect(fixturesCaption({ added: 2, changed: 3, removed: 1, moved: 2, groups: 1 })).toBe('Fixtures: 2 added · 2 moved · 1 changed · 1 removed · 1 group changed');
    expect(fixturesCaption(undefined)).toBe('');
  });
});

// ── Highlight mapping ────────────────────────────────────────────────────────

describe('highlight mapping', () => {
  const model = buildPreviewModel(parseSnapshotPreviewResponse({ snapshotId: 's', layout })!.layout);

  it('marks: added > moved > changed', () => {
    const marks = fixtureMarks({ added: [2], changed: [0, 1], moved: [1, 2], removed: 0 });
    expect([...marks.entries()].sort()).toEqual([[0, 'changed'], [1, 'moved'], [2, 'added']]);
  });

  it('rings surround the fixture in viewport px with the renderer camera', () => {
    const rings = highlightRings(model, new Map([[1, 'added'], [9, 'changed']]), 320, 200);
    expect(rings).toHaveLength(1);
    const cam = fitCamera(model.bounds, 320, 200);
    const f = model.fixtures[1]!;
    const sx = f.cx * cam.scale + cam.x;
    const sy = f.cy * cam.scale + cam.y;
    const r = rings[0]!;
    expect(r.color).toBe(MARK_COLORS.added);
    expect(r.x + r.width / 2).toBeCloseTo(sx, 5);
    expect(r.y + r.height / 2).toBeCloseTo(sy, 5);
    expect(r.width).toBeGreaterThan(f.hw * 2 * cam.scale);
  });

  it('preset colours per category, dimmer scaling, programmed-only fixtures, recolouring', () => {
    expect(categoryColor([{ channelType: 'RED', stepValues: [255] }, { channelType: 'BLUE', stepValues: [128] }])).toBe('#ff0080');
    expect(categoryColor([{ channelType: 'RED', stepValues: [255] }, { channelType: 'DIMMER', stepValues: [0] }])).toBe('#000000');
    expect(categoryColor([{ channelType: 'PAN', stepValues: [3] }])).toBeNull();
    expect(categoryColor('nope')).toBeNull();
    const preset = {
      id: 'p', name: 'Red', createdAt: '',
      categories: [
        { type: 'color', label: '', fixtureIds: ['a', 'zz'], channels: [{ channelIndex: 0, channelType: 'RED', stepValues: [255] }], modifiers: [] },
        { type: 'movement', label: '', fixtureIds: ['a', 'b'], channels: [{ channelIndex: 1, channelType: 'PAN', stepValues: [10] }], modifiers: [] },
      ],
    } as unknown as Preset;
    const colors = presetFixtureColors(preset, { a: 0, b: 1, c: 2 });
    expect([...colors.entries()].sort()).toEqual([[0, '#ff0000'], [1, '#e4e4e7']]);
    const recolored = recolorModel(model, colors);
    expect(recolored.fixtures.map(f => f.color)).toEqual(['#ff0000', '#e4e4e7', UNTOUCHED_COLOR]);
    expect(model.fixtures[2]!.color).not.toBe(UNTOUCHED_COLOR);
    expect(presetSummary(preset)).toBe('Color · Movement · 3 fixtures');
    expect(presetSummary({ ...preset, type: 'flash', categories: null } as unknown as Preset)).toBe('Flash preset · 0 fixtures');
    expect(presetStatusText({ status: 'changed', preset, changedKeys: ['categories', 'basePresetId'] })).toBe('Changed: content, base preset id');
  });
});

// ── Controller ───────────────────────────────────────────────────────────────

describe('preview controller with highlights', () => {
  it('passes compareToId, caches highlights and reloads for a new diff base', async () => {
    const invoke = vi.fn(async (_n: string, opts?: { body?: Record<string, unknown> }) => ({
      data: { snapshotId: 's1', layout, highlights: { ...wire, previousId: (opts?.body?.compareToId as string) ?? 'auto' } },
      error: null,
    }));
    const client: RemoteClient = { functions: { invoke } };
    const preview = createVersionPreview({ projectId: PID, client: () => client, online: ref(true) });
    await preview.load('s1', null);
    expect(invoke.mock.calls[0]![1]!.body).toEqual({ projectId: PID, snapshotId: 's1' });
    expect(preview.state('s1').value.highlights?.previousId).toBe('auto');
    await preview.load('s1', null);
    expect(invoke).toHaveBeenCalledTimes(1);
    await preview.load('s1', 'older');
    expect(invoke.mock.calls[1]![1]!.body).toEqual({ projectId: PID, snapshotId: 's1', compareToId: 'older' });
    expect(preview.state('s1').value.highlights?.previousId).toBe('older');
    // A fresh controller is served from the cache.
    const again = createVersionPreview({ projectId: PID, client: () => client, online: ref(false) });
    expect(again.state('s1').value).toMatchObject({ status: 'ready' });
  });

  it('keeps the cached result when reloading for another base fails', async () => {
    let fail = false;
    const invoke = vi.fn(async () => (fail ? { data: null, error: { message: 'boom' } } : { data: { snapshotId: 's1', layout, highlights: wire }, error: null }));
    const preview = createVersionPreview({ projectId: PID, client: () => ({ functions: { invoke } }), online: ref(true) });
    await preview.load('s1');
    fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await preview.load('s1', 'other');
    warn.mockRestore();
    expect(preview.state('s1').value.status).toBe('ready');
  });
});
