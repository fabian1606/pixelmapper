/**
 * Effect hover preview component (happy-dom): with a mocked preview pool it
 * animates the target fixtures only, paints per-frame colors on a fake 2D
 * context, stops on unmount, stays static while the pool returns null and
 * starts once an instance becomes ready, and draws one frame under reduced
 * motion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import type { ModifierInstance } from '~/utils/engine/types';
import * as pool from '~/utils/plugins/preview-pool';
import { PREVIEW_SHAPE, type PreviewFixture } from '~/utils/sync/remote-api-snapshot-preview';
import type { EffectHighlight } from '~/utils/sync/version-preview/highlight-types';
import { buildPreviewModel } from '~/utils/sync/version-preview/preview-model';
import VersionEffectPreview from './VersionEffectPreview.vue';

vi.mock('~/utils/plugins/preview-pool', async () => {
  const { shallowRef } = await import('vue');
  return {
    previewRevision: shallowRef(0),
    renderPoints: vi.fn(),
    releasePreview: vi.fn(),
  };
});

const renderPoints = vi.mocked(pool.renderPoints);
const releasePreview = vi.mocked(pool.releasePreview);

/** Layout fixture with defaults. */
const fx = (x: number, p: Partial<PreviewFixture> = {}): PreviewFixture => ({ x, y: 0.5, w: 1, h: 1, r: 0, color: '#ff0000', shape: PREVIEW_SHAPE.single, beams: 1, group: -1, ...p });
const model = buildPreviewModel({ fixtures: [fx(0.2), fx(0.4), fx(0.6, { shape: PREVIEW_SHAPE.multi, beams: 4, w: 4 })], groups: [], total: 3, truncated: false });
const fixtureIndex = { a: 0, b: 1, bar: 2 };

/** Highlight of a waveform targeting `ids`. */
function highlight(ids: string[] | undefined, mod: Partial<ModifierInstance> = {}): EffectHighlight {
  const m = { ...createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'] }), targetFixtureIds: ids, ...mod };
  return { status: 'changed', modifier: m, changedKeys: ['strength'], before: { strength: 0.5 } };
}

// ── Fake raf, clock and 2D context ────────────────────────────────────────

let clock = 0;
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 1;
/** Fill styles set per frame on the fake context. */
let fills: string[] = [];

/** Advances the clock and runs pending frames. */
function step(ms: number, times = 1): void {
  for (let i = 0; i < times; i++) {
    clock += ms;
    const cbs = [...rafQueue.values()];
    rafQueue.clear();
    cbs.forEach(cb => cb(clock));
  }
}

/** Minimal recording CanvasRenderingContext2D. */
function fakeContext(): CanvasRenderingContext2D {
  const noop = () => {};
  const ctx: Record<string, unknown> = {};
  for (const k of ['setTransform', 'clearRect', 'strokeRect', 'save', 'restore', 'translate', 'rotate', 'beginPath', 'ellipse', 'roundRect', 'rect', 'arc', 'fill', 'stroke']) ctx[k] = noop;
  Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => fills.push(v), get: () => '' });
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Result with `n` scalar values `v`. */
const result = (n: number, v: number) => ({ values: new Float32Array(n).fill(v), arity: 1 });

beforeEach(() => {
  clock = 0;
  rafQueue = new Map();
  fills = [];
  renderPoints.mockReset();
  releasePreview.mockReset();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.set(rafId, cb); return rafId++; });
  vi.stubGlobal('cancelAnimationFrame', (h: number) => { rafQueue.delete(h); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VersionEffectPreview', () => {
  it('animates the target fixtures only and records frame times', () => {
    renderPoints.mockImplementation((_m, points) => result(points.length, 0.5));
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(['b']), fixtureIndex } });
    step(1000 / 60, 60);
    expect(renderPoints.mock.calls.length).toBeGreaterThanOrEqual(30);
    const [m, points, opts] = renderPoints.mock.calls[0]!;
    expect(m.id).toBe(w.props('highlight').modifier.id);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ x: 0.4, y: 0.5 });
    expect(opts?.instanceKey).toMatch(/^version-preview:/);
    // Scalar 0.5 tints the red fixture.
    expect(fills).toContain('rgb(128,0,0)');
    const canvas = w.get('canvas').element as HTMLCanvasElement;
    expect(Number(canvas.dataset.frameCount)).toBe(renderPoints.mock.calls.length);
    expect(canvas.dataset.frameMs).toBeDefined();
    expect(w.get('[data-testid="effect-detail"]').text()).toBe('Strength 50 % → 100 %');
    w.unmount();
  });

  it('samples every pixel of a targeted bar', () => {
    renderPoints.mockImplementation((_m, points) => result(points.length, 1));
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(['bar']), fixtureIndex } });
    expect(renderPoints.mock.calls[0]![1]).toHaveLength(4);
    w.unmount();
  });

  it('stops the loop and releases the instance on unmount', () => {
    renderPoints.mockImplementation((_m, points) => result(points.length, 0.5));
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(undefined), fixtureIndex } });
    step(40, 3);
    w.unmount();
    const calls = renderPoints.mock.calls.length;
    expect(rafQueue.size).toBe(0);
    step(40, 5);
    expect(renderPoints.mock.calls.length).toBe(calls);
    expect(releasePreview).toHaveBeenCalledWith(expect.stringMatching(/^version-preview:/));
  });

  it('stays static while the pool returns null and animates once ready', async () => {
    renderPoints.mockReturnValue(null);
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(['a']), fixtureIndex } });
    step(40, 5);
    expect(renderPoints).toHaveBeenCalledTimes(1);
    expect(rafQueue.size).toBe(0);
    // Static frame: target in its base color.
    expect(fills).toContain('#ff0000');
    renderPoints.mockImplementation((_m, points) => result(points.length, 1));
    pool.previewRevision.value++;
    await nextTick();
    step(40, 3);
    expect(renderPoints.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(rafQueue.size).toBe(1);
    w.unmount();
  });

  it('draws a static frame for unknown plugins without rendering', () => {
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(['a'], { plugin: 'sha256:unknown' }), fixtureIndex } });
    step(40, 3);
    expect(renderPoints).not.toHaveBeenCalled();
    expect(w.get('[data-testid="effect-title"]').text()).toBe('Unknown effect — changed');
    w.unmount();
  });

  it('renders a single frame under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }));
    renderPoints.mockImplementation((_m, points) => result(points.length, 0.5));
    const w = mount(VersionEffectPreview, { props: { model, highlight: highlight(['a']), fixtureIndex } });
    step(40, 5);
    expect(renderPoints).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
