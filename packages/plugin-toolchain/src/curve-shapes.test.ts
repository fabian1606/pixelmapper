// @vitest-environment node
/**
 * Curve v2 (plan M1.2–M1.4, M2.5 conversion): shape registry, free-point
 * sampling, legacy bit-identity and LUT domains.
 */
import { describe, expect, it } from 'vitest';
import type { CurvePoint, CurveValue } from '@pixelmapper/extension-api';
import {
  BUILTIN_SHAPE_IDS,
  clampArgs,
  defaultArgs,
  evaluateCurve,
  getShape,
  listShapes,
  registerShape,
  sampleCurveLut,
  shapeToPoints,
} from './curve-shapes';
import { evaluatePoints } from './curve-points';
import { encodeParams } from './params';

/** The v1 sampler, copied verbatim (golden reference). */
function legacyLut(points: CurvePoint[], size = 128): Float32Array {
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const t2 = t * t; const t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const sample = (x: number) => {
    const n = points.length;
    if (n === 0) return 0;
    if (n === 1) return points[0]!.y;
    const cx = Math.max(0, Math.min(1, x));
    let i = 1;
    while (i < n - 1 && points[i]!.x < cx) i++;
    const p1 = points[i - 1]!; const p2 = points[i]!;
    const segW = p2.x - p1.x;
    const t = segW < 1e-9 ? 0 : Math.max(0, Math.min(1, (cx - p1.x) / segW));
    const p0y = i > 1 ? points[i - 2]!.y : p1.y;
    const p3y = i < n - 1 ? points[i + 1]!.y : p2.y;
    return Math.max(0, cr(p0y, p1.y, p2.y, p3y, t));
  };
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = Math.min(1, sample(size === 1 ? 0 : i / (size - 1)));
  return lut;
}

const shape = (id: string, args: Record<string, number> = {}): CurveValue => ({ shape: id, args });
const ctx = { ticks: 8 };

describe('legacy curves', () => {
  it('LUT is byte-identical to v1', () => {
    const sets: CurvePoint[][] = [
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0.2 }, { x: 0.3, y: 0.9 }, { x: 0.6, y: 0.1 }, { x: 1, y: 0.7 }],
      [{ x: 0, y: 1 }, { x: 0.1, y: 0 }, { x: 0.2, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0 }, { x: 1, y: 1 }],
    ];
    for (const pts of sets) expect(sampleCurveLut(pts)).toEqual(legacyLut(pts));
  });

  it('encodeParams of a legacy curve param is unchanged', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.4, y: 1 }, { x: 1, y: 0.2 }];
    const buf = encodeParams([{ key: 'c', type: 'curve', label: 'C', default: pts }], {});
    expect(buf).toEqual(legacyLut(pts));
  });
});

describe('free points', () => {
  it('linear and step segments', () => {
    const pts = [{ x: 0, y: 0, kind: 'linear' as const }, { x: 0.5, y: 1, kind: 'step' as const }, { x: 1, y: 0 }];
    expect(evaluatePoints(pts, 0.25)).toBeCloseTo(0.5);
    expect(evaluatePoints(pts, 0.75)).toBe(1);
    expect(evaluatePoints(pts, 1)).toBe(0);
  });

  it('Bézier with flat handles is a smoothstep', () => {
    const pts = [{ x: 0, y: 0, kind: 'corner' as const, out: { dx: 1 / 3, dy: 0 } }, { x: 1, y: 1, in: { dx: -1 / 3, dy: 0 } }];
    for (const x of [0.1, 0.3, 0.5, 0.8]) expect(evaluatePoints(pts, x)).toBeCloseTo(x * x * (3 - 2 * x), 4);
  });

  it('default handles follow Catmull-Rom tangents (straight line stays straight)', () => {
    const pts = [{ x: 0, y: 0, kind: 'smooth' as const }, { x: 0.5, y: 0.5, kind: 'smooth' as const }, { x: 1, y: 1 }];
    for (const x of [0.2, 0.4, 0.7]) expect(evaluatePoints(pts, x)).toBeCloseTo(x, 4);
  });
});

describe('shape registry', () => {
  it('registers all built-ins', () => {
    for (const id of ['dot', 'bar', 'wave', 'wedge', 'edge', 'flash', 'run', 'pingpong', 'step', 'hold', 'ease']) {
      expect(getShape(id)).toBeDefined();
      expect(BUILTIN_SHAPE_IDS).toContain(id);
    }
    expect(listShapes().length).toBeGreaterThanOrEqual(11);
  });

  it('dot: lit at its center, dark outside its width, periodic', () => {
    const v = shape('dot', { width: 0.2, softness: 0 });
    expect(evaluateCurve(v, 0, ctx, 'signed')).toBe(1);
    expect(evaluateCurve(v, 0.09, ctx, 'signed')).toBe(1);
    expect(evaluateCurve(v, 0.2, ctx, 'signed')).toBe(0);
    expect(evaluateCurve(v, 1, ctx, 'signed')).toBe(1);
    const r3 = shape('dot', { width: 0.2, softness: 0, repeat: 3 });
    expect(evaluateCurve(r3, 1 / 3, ctx, 'signed')).toBe(1);
  });

  it('peak and floor bound every shape', () => {
    const v = shape('wave', { peak: 0.8, floor: 0.2 });
    expect(evaluateCurve(v, 0, ctx, 'signed')).toBeCloseTo(0.8);
    expect(evaluateCurve(v, 0.5, ctx, 'signed')).toBeCloseTo(0.2);
  });

  it('wedge trails behind the head; length 1 is a saw', () => {
    const v = shape('wedge', { length: 0.5 });
    expect(evaluateCurve(v, 0, ctx, 'signed')).toBe(1);
    expect(evaluateCurve(v, -0.25, ctx, 'signed')).toBeCloseTo(0.5);
    expect(evaluateCurve(v, 0.1, ctx, 'signed')).toBe(0);
    const saw = shape('wedge', { length: 1 });
    expect(evaluateCurve(saw, -0.75, ctx, 'signed')).toBeCloseTo(0.25);
  });

  it('edge fills everything behind the position (non-periodic)', () => {
    const v = shape('edge', { softness: 0 });
    expect(evaluateCurve(v, -0.9, ctx, 'signed')).toBe(1);
    expect(evaluateCurve(v, 0.9, ctx, 'signed')).toBe(0);
  });

  it('flash rises over attack, then decays', () => {
    const v = shape('flash', { attack: 0.1, decay: 0.2 });
    expect(evaluateCurve(v, -0.05, ctx, 'signed')).toBeCloseTo(0.5);
    expect(evaluateCurve(v, -0.1, ctx, 'signed')).toBeCloseTo(1);
    expect(evaluateCurve(v, -0.3, ctx, 'signed')).toBeCloseTo(Math.exp(-1), 3);
  });

  it('motion shapes', () => {
    expect(evaluateCurve(shape('run'), 0.3)).toBeCloseTo(0.3);
    expect(evaluateCurve(shape('pingpong'), 0.75)).toBeCloseTo(0.5);
    expect(evaluateCurve(shape('step', { count: 4 }), 0.6)).toBeCloseTo(0.5);
    expect(evaluateCurve(shape('step', { count: 0 }), 0.6, { ticks: 5 })).toBeCloseTo(0.6);
    expect(evaluateCurve(shape('hold', { pause: 0.5 }), 0.25)).toBeCloseTo(0.5);
    expect(evaluateCurve(shape('hold', { pause: 0.5 }), 0.75)).toBe(1);
    expect(evaluateCurve(shape('hold', { pause: 1 }), 0)).toBe(1);
    expect(evaluateCurve(shape('ease'), 0.5)).toBeCloseTo(0.5, 3);
  });

  it('clamps args and fills defaults', () => {
    const def = getShape('dot')!;
    expect(clampArgs(def, { width: 5, softness: -1 })).toMatchObject({ width: 1, softness: 0, repeat: 1, peak: 1, floor: 0 });
    expect(defaultArgs(def)).toMatchObject({ width: 0.15, softness: 0.5 });
  });

  it('unknown shapes evaluate to 0', () => {
    expect(evaluateCurve(shape('nope'), 0.5)).toBe(0);
  });

  it('extension shapes register and sample on the wire', () => {
    const dispose = registerShape({
      id: 'test/half', label: 'Half', domain: 'cycle', periodic: false, args: [],
      evaluate: x => (x < 0.5 ? 0 : 1),
    });
    const buf = encodeParams([{ key: 'c', type: 'curve', label: 'C', default: { shape: 'test/half', args: {} } }]);
    expect(buf[10]).toBe(0);
    expect(buf[100]).toBe(1);
    dispose();
    expect(getShape('test/half')).toBeUndefined();
  });
});

describe('LUT domains (M1.4)', () => {
  it('cycle samples x = i/127, signed samples x = −1 + 2i/127', () => {
    const run = sampleCurveLut(shape('run'), 128, ctx, 'cycle');
    expect(run[0]).toBe(0);
    expect(run[127]).toBe(1);
    expect(run[64]).toBeCloseTo(64 / 127);
    const edge = sampleCurveLut(shape('edge', { softness: 0 }), 128, ctx, 'signed');
    expect(edge[0]).toBe(1);
    expect(edge[127]).toBe(0);
    expect(edge[50]).toBe(1);
    expect(edge[80]).toBe(0);
  });

  it('encodeParams uses the param domain and ticks', () => {
    const def = { key: 'm', type: 'curve' as const, label: 'M', default: { shape: 'step', args: { count: 0 } } };
    const buf = encodeParams([def], {}, { ticks: 4 });
    expect(buf[40]).toBeCloseTo(0.25);
  });
});

describe('shape → free points (M2.5)', () => {
  const cases: [string, Record<string, number>, 'cycle' | 'signed'][] = [
    ['dot', {}, 'signed'], ['dot', { width: 0.3, softness: 0, repeat: 3 }, 'signed'], ['bar', {}, 'signed'],
    ['wave', { repeat: 2, floor: 0.2 }, 'signed'], ['wedge', {}, 'signed'], ['edge', {}, 'signed'], ['edge', { softness: 0 }, 'signed'],
    ['flash', {}, 'signed'], ['run', {}, 'cycle'], ['pingpong', {}, 'cycle'], ['step', { count: 3 }, 'cycle'],
    ['step', { count: 0 }, 'cycle'], ['hold', {}, 'cycle'], ['ease', { in: 0.2, out: 0.7 }, 'cycle'],
  ];
  it.each(cases)('%s %j converts within ±1e-2', (id, args, domain) => {
    const v = shape(id, args);
    const want = sampleCurveLut(v, 128, ctx, domain);
    const got = sampleCurveLut({ points: shapeToPoints(v, ctx, domain) }, 128, ctx, domain);
    for (let i = 0; i < 128; i++) expect(Math.abs(got[i]! - want[i]!), `i=${i}`).toBeLessThanOrEqual(1e-2);
  });
});
