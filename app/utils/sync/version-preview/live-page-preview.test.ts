// @vitest-environment node
/**
 * Live page miniature (version-history hover preview): fitting for various
 * aspect ratios / columns, malformed page settings, clamped widgets, status
 * mapping, kinds and labels, page ordering and the removed / summary text.
 */
import { describe, expect, it } from 'vitest';
import type { LiveMapping, LivePage, LiveWidget } from '~/utils/live/types';
import type { LivePageHighlight } from '~/utils/sync/version-preview/highlight-types';
import { layoutLivePage, livePageSummary, pickLivePages, removedPagesText, removedWidgetsText, safeColor } from '~/utils/sync/version-preview/live-page-preview';
import { widgetDisplayLabel, widgetKind } from '~/utils/sync/version-preview/live-page-text';

/** Widget with defaults. */
function widget(id: string, over: Partial<LiveWidget> = {}): LiveWidget {
  return { id, type: 'button', gridX: 0, gridY: 0, gridW: 3, gridH: 3, mapping: { type: 'none' }, ...over };
}

/** Page with defaults (60 × 32 px, 16:9 → 1920 × 1080). */
function page(over: Partial<LivePage> = {}): LivePage {
  return { id: 'p1', name: 'Main', columns: 60, aspectRatioW: 16, aspectRatioH: 9, gridSize: 32, backgroundColor: '#0a0a0a', widgets: [], ...over };
}

/** Highlight entry with defaults. */
function hl(over: Partial<LivePageHighlight> = {}): LivePageHighlight {
  return { status: 'changed', page: page(), addedWidgets: [], changedWidgets: [], removedWidgets: [], sectionsChanged: false, ...over };
}

describe('layoutLivePage', () => {
  it('fits a 16:9 page by width and centers it vertically', () => {
    const l = layoutLivePage(page(), 320, 200)!;
    expect(l.scale).toBeCloseTo(320 / 1920);
    expect(l.width).toBeCloseTo(320);
    expect(l.height).toBeCloseTo(180);
    expect(l.offsetX).toBeCloseTo(0);
    expect(l.offsetY).toBeCloseTo(10);
  });

  it('fits a portrait page by height and honours padding', () => {
    const l = layoutLivePage(page({ columns: 20, aspectRatioW: 9, aspectRatioH: 16 }), 320, 200, undefined, 4)!;
    // 640 × 1138 px → height bound (192 px available).
    expect(l.height).toBeCloseTo(192);
    expect(l.offsetY).toBeCloseTo(4);
    expect(l.offsetX).toBeGreaterThan(100);
  });

  it('falls back to defaults for zero / invalid page settings', () => {
    const l = layoutLivePage(page({ columns: 0, gridSize: Number.NaN, aspectRatioW: -1, aspectRatioH: 0, backgroundColor: 'url(x)' }), 320, 200)!;
    expect(l.width).toBeCloseTo(320);
    expect(l.height).toBeCloseTo(180);
    expect(l.background).toBe('#0a0a0a');
    expect(layoutLivePage(null, 320, 200)).toBeNull();
  });

  it('maps grid units to viewport px', () => {
    const l = layoutLivePage(page({ widgets: [widget('a', { gridX: 6, gridY: 3, gridW: 12, gridH: 6 })] }), 320, 200)!;
    const unit = 32 * l.scale;
    expect(l.widgets[0]).toMatchObject({ x: 6 * unit, y: 3 * unit, width: 12 * unit, height: 6 * unit });
  });

  it('clamps widgets outside the page and repairs invalid sizes', () => {
    const l = layoutLivePage(page({ widgets: [
      widget('out', { gridX: 500, gridY: -4, gridW: 10, gridH: 3 }),
      widget('neg', { type: 'slider', gridW: -2, gridH: Number.NaN }),
      widget('wide', { gridX: 55, gridW: 20 }),
    ] }), 320, 200)!;
    const unit = 32 * l.scale;
    const [out, neg, wide] = l.widgets;
    expect(out!.x).toBeCloseTo(59 * unit);
    expect(out!.width).toBeCloseTo(unit);
    expect(out!.y).toBe(0);
    expect(neg!.width).toBeCloseTo(2 * unit); // slider default 2 × 6
    expect(neg!.height).toBeCloseTo(6 * unit);
    expect(wide!.x + wide!.width).toBeCloseTo(l.width);
  });

  it('maps statuses (added wins) and draws highlighted widgets last', () => {
    const p = page({ widgets: [widget('a'), widget('b'), widget('c')] });
    const l = layoutLivePage(p, 320, 200, { addedWidgets: ['a', 'c'], changedWidgets: ['b', 'c'] })!;
    expect(l.widgets.map(w => [w.id, w.status])).toEqual([['a', 'added'], ['b', 'changed'], ['c', 'added']]);
    const l2 = layoutLivePage(p, 320, 200, { changedWidgets: ['a'] })!;
    expect(l2.widgets.map(w => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('survives malformed widgets', () => {
    const p = page({ widgets: [null, 'x', { gridX: 1 }, widget('ok', { color: 'red;x' })] as unknown as LiveWidget[] });
    const l = layoutLivePage(p, 320, 200)!;
    expect(l.widgets).toHaveLength(2);
    expect(l.widgets[0]!.kind).toBe('extension');
    expect(l.widgets[1]!.color).toBeNull();
    expect(layoutLivePage({ ...page(), widgets: undefined } as unknown as LivePage, 320, 200)!.widgets).toEqual([]);
  });
});

describe('kinds and labels', () => {
  it('maps core, legacy and extension types', () => {
    expect(widgetKind('xy-pad')).toBe('xy');
    expect(widgetKind('color-wheel')).toBe('color');
    expect(widgetKind('fixture-preview')).toBe('fixture-preview');
    expect(widgetKind('acme/knob')).toBe('extension');
    expect(widgetKind(42)).toBe('extension');
  });

  it('derives labels from label, the first button action or type', () => {
    const action = (m: LiveMapping) => ({ id: 'x', trigger: 'press' as const, action: m });
    expect(widgetDisplayLabel(widget('a', { label: ' Go ' }))).toBe('Go');
    expect(widgetDisplayLabel(widget('a', { actions: [action({ type: 'none' }), action({ type: 'global-function', globalFunction: 'strobe' })] }))).toBe('Strobe');
    expect(widgetDisplayLabel(widget('a', { actions: [action({ type: 'global-function', globalFunction: 'speed', globalFunctionConfig: { multiplier: 0, behavior: 'hold' } })] }))).toBe('Freeze');
    expect(widgetDisplayLabel(widget('a', { type: 'acme/big-knob' }))).toBe('Big knob');
    expect(widgetDisplayLabel(widget('a', { type: 'controller-twin', controllerKey: 'apc-mini' }))).toBe('apc-mini');
    expect(widgetDisplayLabel(widget('a', { type: 'beat' }))).toBe('BPM');
  });

  it('accepts hex / rgb / hsl colors only', () => {
    expect(safeColor('#ff0000')).toBe('#ff0000');
    expect(safeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(safeColor('red; background: url(x)')).toBeNull();
    expect(safeColor(5)).toBeNull();
  });
});

describe('pages and text', () => {
  it('orders pages by change count, changed before added on ties', () => {
    const a = hl({ page: page({ id: 'a' }), changedWidgets: ['1'] });
    const b = hl({ page: page({ id: 'b' }), addedWidgets: ['1', '2'], changedWidgets: ['3'] });
    const c = hl({ status: 'added', page: page({ id: 'c' }), addedWidgets: ['1'] });
    const d = hl({ page: page({ id: 'd' }), sectionsChanged: true });
    const bad = { status: 'changed' } as unknown as LivePageHighlight;
    expect(pickLivePages([c, a, bad, b, d]).map(h => h.page.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(pickLivePages(undefined)).toEqual([]);
  });

  it('lists removed widgets with a limit', () => {
    const list = ['Strobe', '', 'A', 'B', 'C'].map((label, i) => ({ id: `${i}`, type: i === 1 ? 'slider' : 'button', label }));
    expect(removedWidgetsText(list, 3)).toBe('Removed: Strobe, Slider, A +2 more');
    expect(removedWidgetsText(list.slice(0, 1))).toBe('Removed: Strobe');
    expect(removedWidgetsText([])).toBe('');
    expect(removedPagesText([{ id: 'x', name: 'Intro' }])).toBe('Removed page: Intro');
    expect(removedPagesText([{ id: 'x', name: '' }, { id: 'y', name: 'B' }])).toBe('Removed pages: Untitled page, B');
  });

  it('summarises a page for screen readers', () => {
    expect(livePageSummary(hl({ addedWidgets: ['a', 'b'], changedWidgets: ['c'] }))).toBe('Live page Main: 2 widgets added, 1 changed');
    expect(livePageSummary(hl({ changedWidgets: ['c'] }))).toBe('Live page Main: 1 widget changed');
    expect(livePageSummary(hl({ status: 'added', page: page({ widgets: [widget('a')] }) }))).toBe('Live page Main added with 1 widget');
    expect(livePageSummary(hl({ sectionsChanged: true }))).toBe('Live page Main: sections changed');
  });
});
