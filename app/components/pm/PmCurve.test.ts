/**
 * `pm.curve` v2 (plan M2.2, M2.4, M2.5): shape bar, arg handles per kind with
 * tick snapping, one scrub per drag, and free-point editing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { CurvePointV2, CurveShapeValue, CurveValue } from '@pixelmapper/extension-api';
import PmCurve from './PmCurve.vue';
import { dragTangent, insertPoint, removePoint, setKind } from './curve/use-free-points';
import { sampleCurveLut, shapeToPoints } from '~/utils/params/curve-shapes';

/** Editor box: 240 × 72 px at the origin (SVG units = px). */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 240, height: 72, right: 240, bottom: 72, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

/** Client x of a signed-domain x; client y of a value. */
const cx = (x: number) => ((x + 1) / 2) * 240;
const cy = (y: number) => 72 - 6 - y * 60;

/** Mounts a signed profile editor. */
function mountProfile(value: CurveValue, extra: Record<string, unknown> = {}) {
  return mount(PmCurve, {
    props: { modelValue: value, domain: 'signed', axis: 'fixtures', ticks: 8, shapes: ['dot', 'bar', 'wave', 'wedge', 'edge', 'flash'], ...extra },
  });
}

/** Drags handle `key` to client (x, y). */
async function dragHandle(w: ReturnType<typeof mount>, key: string, x: number, y: number, shiftKey = false) {
  await w.find(`[data-handle="${key}"]`).trigger('pointerdown', { button: 0, clientX: 0, clientY: 0 });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, shiftKey }));
  window.dispatchEvent(new PointerEvent('pointerup'));
}

const lastValue = (w: ReturnType<typeof mount>) => (w.emitted('update:modelValue')!.at(-1)![0]) as CurveShapeValue;

describe('shape bar (M2.2)', () => {
  it('each shape emits a valid value; peak/floor and same-key args carry over', async () => {
    const w = mountProfile({ shape: 'dot', args: { width: 0.3, peak: 0.8, floor: 0.1 } });
    const buttons = w.findAll('[role="toolbar"] button');
    expect(buttons.map(b => b.text())).toEqual(['Dot', 'Bar', 'Wave', 'Wedge', 'Edge (fill)', 'Flash', 'Free']);
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    await buttons[1]!.trigger('click');
    expect(lastValue(w)).toEqual({ shape: 'bar', args: { width: 0.3, softness: 0, repeat: 1, peak: 0.8, floor: 0.1 } });
    await buttons[2]!.trigger('click');
    expect(lastValue(w).shape).toBe('wave');
    expect(w.emitted('scrubStart')!.length).toBe(2);
    expect(w.emitted('scrubEnd')!.length).toBe(2);
  });
});

describe('arg handles (M2.4)', () => {
  it('edgeX: width follows the flank and snaps to fixture ticks unless Shift is held', async () => {
    const w = mountProfile({ shape: 'dot', args: { width: 0.15, softness: 0.5 } });
    // Pointer at x = 0.26 → snaps to the tick at 0.25 → width 0.5.
    await dragHandle(w, 'width', cx(0.26), cy(0.5));
    expect(lastValue(w).args.width).toBeCloseTo(0.5);
    await dragHandle(w, 'width', cx(0.26), cy(0.5), true);
    expect(lastValue(w).args.width).toBeCloseTo(0.52, 2);
    expect(w.emitted('scrubStart')!.length).toBe(2);
    expect(w.emitted('scrubEnd')!.length).toBe(2);
  });

  it('pointOnEdge: softness from the plateau edge', async () => {
    const w = mountProfile({ shape: 'dot', args: { width: 0.4, softness: 0.5 } });
    // Plateau half-width 0.2·(1 − s) = 0.05 → s = 0.75.
    await dragHandle(w, 'softness', cx(0.05), cy(1));
    expect(lastValue(w).args.softness).toBeCloseTo(0.75, 2);
  });

  it('lineY: peak and floor follow the pointer height', async () => {
    const w = mountProfile({ shape: 'wave', args: {} });
    await dragHandle(w, 'peak', cx(0.8), cy(0.7));
    expect(lastValue(w).args.peak).toBeCloseTo(0.7, 2);
    await dragHandle(w, 'floor', cx(-0.8), cy(0.25));
    expect(lastValue(w).args.floor).toBeCloseTo(0.25, 2);
  });

  it('double-click resets an arg to its default', async () => {
    const w = mountProfile({ shape: 'dot', args: { width: 0.6 } });
    await w.find('[data-handle="width"]').trigger('dblclick');
    expect(lastValue(w).args.width).toBe(0.15);
  });

  it('steppers change args without handles', async () => {
    const w = mountProfile({ shape: 'dot', args: {} });
    await w.find('[data-stepper="repeat"] button[aria-label="Increase Repeat"]').trigger('click');
    expect(lastValue(w).args.repeat).toBe(2);
  });

  it('draws a playhead when given', () => {
    const w = mount(PmCurve, { props: { modelValue: { shape: 'run', args: {} }, shapes: ['run'], playhead: 0.5 } });
    expect(w.find('[data-playhead]').exists()).toBe(true);
  });
});

describe('free points (M2.5)', () => {
  it('"Free" converts the shape; "Back to shape" restores it', async () => {
    const w = mountProfile({ shape: 'edge', args: { softness: 0.2 } });
    await w.findAll('[role="toolbar"] button').at(-1)!.trigger('click');
    const free = w.emitted('update:modelValue')!.at(-1)![0] as { points: CurvePointV2[] };
    expect(Array.isArray(free.points)).toBe(true);
    await w.setProps({ modelValue: free });
    await w.find('button.underline-offset-2').trigger('click');
    expect(lastValue(w)).toEqual({ shape: 'edge', args: { softness: 0.2 } });
  });

  it('converted LUT equals the shape LUT ± 1e-2', () => {
    const v = { shape: 'dot', args: { width: 0.3 } };
    const a = sampleCurveLut(v, 128, { ticks: 8 }, 'signed');
    const b = sampleCurveLut({ points: shapeToPoints(v, { ticks: 8 }, 'signed') }, 128, { ticks: 8 }, 'signed');
    a.forEach((y, i) => expect(Math.abs(y - b[i]!)).toBeLessThanOrEqual(1e-2));
  });

  it('insert, delete, kind change and tangent drag', () => {
    const pts = [{ x: 0, y: 0, kind: 'smooth' as const }, { x: 1, y: 1 }];
    const ins = insertPoint(pts, 0.5);
    expect(ins.index).toBe(1);
    expect(ins.points[1]).toMatchObject({ x: 0.5, kind: 'smooth' });
    expect(removePoint(ins.points, 1)).toHaveLength(2);
    expect(removePoint(ins.points, 0)).toHaveLength(3);
    expect(setKind(ins.points, 1, 'step')[1]!.kind).toBe('step');
    const t = dragTangent(ins.points, 1, 'out', { dx: 0.2, dy: 0.1 }, false);
    expect(t[1]!.out).toEqual({ dx: 0.2, dy: 0.1 });
    // Smooth: the in handle stays collinear (opposite direction).
    expect(t[1]!.in!.dy / t[1]!.in!.dx).toBeCloseTo(0.5);
    expect(dragTangent(ins.points, 1, 'out', { dx: 0.2, dy: 0.1 }, true)[1]!.kind).toBe('corner');
  });

  it('component: drag a point, delete with double-click, menu sets the kind', async () => {
    const pts = { points: [{ x: 0, y: 0, kind: 'linear' as const }, { x: 0.5, y: 0.5, kind: 'linear' as const }, { x: 1, y: 1 }] };
    const w = mount(PmCurve, { props: { modelValue: pts } });
    await w.find('[data-point="1"]').trigger('pointerdown', { button: 0 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: cy(0.8) }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    const moved = w.emitted('update:modelValue')!.at(-1)![0] as { points: { x: number; y: number }[] };
    expect(moved.points[1]!.x).toBeCloseTo(0.25);
    expect(moved.points[1]!.y).toBeCloseTo(0.8);
    await w.find('[data-point="1"]').trigger('contextmenu');
    await w.findAll('[role="menuitemradio"]').find(b => b.text() === 'Step')!.trigger('click');
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { points: { kind?: string }[] }).points[1]!.kind).toBe('step');
    await w.find('[data-point="1"]').trigger('dblclick');
    expect((w.emitted('update:modelValue')!.at(-1)![0] as { points: unknown[] }).points).toHaveLength(2);
  });
});
