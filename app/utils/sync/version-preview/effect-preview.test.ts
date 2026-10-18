// @vitest-environment node
/**
 * Effect hover preview, pure parts: targets, sample points (single fixtures,
 * pixel bars, order ranks), value → color mapping, wording of the change
 * and the throttled frame loop (fake raf / clock).
 */
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { ModifierInstance } from '~/utils/engine/types';
import { PREVIEW_SHAPE, type PreviewFixture } from '~/utils/sync/remote-api-snapshot-preview';
import { createEffectAnimator } from './effect-animator';
import { buildEffectPoints, effectColors, effectTargets, parseColor } from './effect-preview';
import { describeEffectChange, effectName, effectTitle, formatSpeed } from './effect-text';
import type { EffectHighlight } from './highlight-types';
import { buildPreviewModel } from './preview-model';

/** Layout fixture with defaults. */
const fx = (x: number, p: Partial<PreviewFixture> = {}): PreviewFixture => ({ x, y: 0.5, w: 1, h: 1, r: 0, color: '#ff0000', shape: PREVIEW_SHAPE.single, beams: 1, group: -1, ...p });

/** Three singles and one 8-pixel bar. */
const model = buildPreviewModel({
  fixtures: [fx(0.1), fx(0.2, { color: '#00ff00' }), fx(0.3, { color: null }), fx(0.5, { shape: PREVIEW_SHAPE.multi, beams: 8, w: 4, h: 1 })],
  groups: [],
  total: 4,
  truncated: false,
});
const index = { a: 0, b: 1, c: 2, bar: 3 };
const waveform = () => createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'] });

describe('effect targets and points', () => {
  it('targets all fixtures when targetFixtureIds is undefined, else the indexed ids', () => {
    expect(effectTargets({}, model, index)).toEqual([0, 1, 2, 3]);
    expect(effectTargets({ targetFixtureIds: ['bar', 'a', 'missing', 'a'] }, model, index)).toEqual([0, 3]);
  });

  it('builds one point per single fixture and one per dot of a bar', () => {
    const m = waveform();
    const pts = buildEffectPoints(m, model, [0, 3], index);
    expect(pts.points.length).toBe(1 + 8);
    expect(pts.targets).toEqual([{ fixture: 0, start: 0, count: 1 }, { fixture: 3, start: 1, count: 8 }]);
    const bar = pts.points.slice(1);
    expect(bar.map(p => p.head)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(bar.every(p => p.headCount === 8 && p.fixture === 1 && p.fixtureCount === 2)).toBe(true);
    // Dots spread along x around the bar center (0.5).
    expect(bar[0]!.x).toBeLessThan(0.5);
    expect(bar[5]!.x).toBeGreaterThan(0.5); // 6 × 2 grid: dot 5 ends row 1
    expect(pts.points[0]).toMatchObject({ x: 0.1, y: 0.5 });
  });

  it('resolves order ranks over the targets (left to right)', () => {
    const m = waveform();
    m.distribution = { ...m.distribution, scope: 'across', mode: 'order' };
    const pts = buildEffectPoints(m, model, [2, 0, 1], index);
    expect(pts.rankCount).toBe(3);
    expect(pts.ticks).toBe(3);
    expect(pts.points.map(p => p.fixtureRank)).toEqual([2, 0, 1]);
  });

  it('passes fixture colors as rgb bases and tints', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.colorAdjust), { signature: 'rgb' });
    const pts = buildEffectPoints(m, model, [1, 2], index);
    expect(pts.points[0]!.base).toEqual([0, 1, 0]);
    expect(Array.from(pts.tint)).toEqual([0, 1, 0, 1, 1, 1]); // neutral → white
  });
});

describe('effect colors', () => {
  it('parses hex colors and falls back to white', () => {
    expect(parseColor('#f00')).toEqual([1, 0, 0]);
    expect(parseColor('#0000ff')).toEqual([0, 0, 1]);
    expect(parseColor('red')).toEqual([1, 1, 1]);
  });

  it('tints scalar values with the fixture color, passes rgb through', () => {
    const tint = Float32Array.from([1, 0, 0, 1, 1, 1]);
    expect(Array.from(effectColors({ values: Float32Array.from([0.5, 1]), arity: 1 }, tint))).toEqual([128, 0, 0, 255, 255, 255]);
    expect(Array.from(effectColors({ values: Float32Array.from([0, 0.5, 1]), arity: 3 }, tint))).toEqual([0, 128, 255]);
  });
});

describe('effect text', () => {
  const manifest = getManifest(builtinHash(BUILTIN_ALIASES.waveform))!;
  const m = waveform();
  const h = (p: Partial<EffectHighlight>, mod: Partial<ModifierInstance> = {}): EffectHighlight =>
    ({ status: 'changed', modifier: { ...m, ...mod }, changedKeys: [], before: {}, ...p });

  it('names the effect from the manifest', () => {
    expect(effectName(m, manifest)).toContain(manifest.name);
    expect(effectName(m, undefined)).toBe('Unknown effect');
    expect(effectTitle(h({ status: 'added' }), manifest)).toMatch(/ — added$/);
  });

  it('describes added effects with the title', () => {
    expect(describeEffectChange(h({ status: 'added' }), undefined)).toBe('Unknown effect — added');
  });

  it('describes changed speed, strength and params', () => {
    const numeric = manifest.params.find(p => p.type === 'number');
    const keys = ['speed', 'strength', 'params.color'];
    const before: Record<string, unknown> = { speed: { mode: 'time', timeMs: 2000, beatValue: 1, beatOffset: 0 }, strength: 0.5 };
    const text = describeEffectChange(h({ changedKeys: keys, before }, { speed: { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 }, strength: 0.8 }), manifest);
    expect(text).toBe('Speed 2 s → 1 s, Strength 50 % → 80 %, Color');
    if (numeric) {
      const t = describeEffectChange(h({ changedKeys: [`params.${numeric.key}`], before: { [`params.${numeric.key}`]: 0 } }, { params: { ...m.params, [numeric.key]: 1 } }), manifest);
      expect(t.startsWith(numeric.label)).toBe(true);
    }
  });

  it('caps the list and falls back to humanized keys', () => {
    const text = describeEffectChange(h({ changedKeys: ['params.fooBar', 'distribution', 'targetFixtureIds', 'blendMode', 'signature', 'plugin'] }), undefined);
    expect(text).toBe('Foo bar, Spread, Fixtures, Blend mode, +2 more');
    expect(describeEffectChange(h({ changedKeys: [] }), undefined)).toBe('Settings changed');
  });

  it('formats speeds', () => {
    expect(formatSpeed({ mode: 'time', timeMs: 500 })).toBe('500 ms');
    expect(formatSpeed({ mode: 'beat', beatValue: 0.25 })).toBe('1/4 beat');
    expect(formatSpeed({ mode: 'beat', beatValue: 2 })).toBe('2 beats');
    expect(formatSpeed({ mode: 'infinite' })).toBe('∞');
  });
});

describe('effect animator', () => {
  /** Manual raf queue and clock. */
  function fakeLoop() {
    let t = 0;
    let next = 1;
    const queue = new Map<number, (t: number) => void>();
    return {
      now: () => t,
      raf: (cb: (t: number) => void) => { queue.set(next, cb); return next++; },
      caf: (h: number) => { queue.delete(h); },
      /** Advances by `ms` and runs the pending callbacks once. */
      step(ms: number) {
        t += ms;
        const cbs = [...queue.values()];
        queue.clear();
        cbs.forEach(cb => cb(t));
      },
      pending: () => queue.size,
    };
  }

  it('throttles a 60 Hz raf to ~30 fps with elapsed time', () => {
    const loop = fakeLoop();
    const draw = vi.fn(() => true);
    const a = createEffectAnimator({ draw, fps: 30, ...loop });
    a.start();
    expect(draw).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 60; i++) loop.step(1000 / 60);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(32);
    expect((draw.mock.calls.at(-1) as unknown as [number])[0]).toBeCloseTo(1000, -1);
    a.stop();
    expect(a.running).toBe(false);
    expect(loop.pending()).toBe(0);
    loop.step(100);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it('draws a single frame under reduced motion', () => {
    const loop = fakeLoop();
    const draw = vi.fn(() => true);
    const a = createEffectAnimator({ draw, reducedMotion: true, ...loop });
    a.start();
    loop.step(100);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(a.running).toBe(false);
  });

  it('stops when draw returns false and can restart', () => {
    const loop = fakeLoop();
    let animate = false;
    const draw = vi.fn(() => animate);
    const a = createEffectAnimator({ draw, ...loop });
    a.start();
    expect(a.running).toBe(false);
    animate = true;
    a.start();
    loop.step(40);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(a.running).toBe(true);
  });
});
