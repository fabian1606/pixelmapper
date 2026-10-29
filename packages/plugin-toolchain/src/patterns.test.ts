// @vitest-environment node
/**
 * SDK pattern helpers (`patterns.ts`, `patterns-time.ts`): a test plugin
 * evaluates one helper per prepare/render round trip and the results are
 * compared against TS reference implementations at golden points.
 *
 * Inputs travel through the raw params block: slot 0 selects the helper,
 * slots 1..8 are arguments, slot 9 is a point count and slots 10..25 the
 * interleaved points.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPackage, CTX, CTX_FIELDS, PluginInstance, SAMPLE_FIELDS, type ContentPluginManifest } from './index';

// ── Test plugin ──────────────────────────────

/** Helper selectors (slot 0). */
const SEL = {
  dist2: 0, dist3: 1, minDist: 2, nearest: 3, pingPong: 4, mirror: 5, pulse: 6,
  ease: 7, lineTime: 8, loopTime: 9, loopCount: 10, envelope: 11,
} as const;

const SOURCE = `
import { Modifier, Frame, Sample, Out, Params, register } from "@pixelmapper/plugin-sdk";
import {
  dist2, dist3, minDistToPoints, nearestPointIndex, pingPong, mirror, pulse, ease,
  crossingTimeLine, crossingTimeLoop, crossingCount, envelope,
} from "@pixelmapper/plugin-sdk";

class M extends Modifier {
  sel: i32 = 0;
  a: StaticArray<f32> = new StaticArray<f32>(8);
  pts: StaticArray<f32> = new StaticArray<f32>(16);
  count: i32 = 0;
  prepare(p: Params): void {
    this.sel = p.int(0);
    for (let i = 0; i < 8; i++) this.a[i] = p.get(1 + i);
    this.count = p.int(9);
    for (let i = 0; i < 16; i++) this.pts[i] = p.get(10 + i);
  }
  render(ctx: Frame, s: Sample, out: Out): void {
    const a = this.a;
    let v: f32 = 0;
    switch (this.sel) {
      case 0: v = dist2(a[0], a[1], a[2], a[3], a[4]); break;
      case 1: v = dist3(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]); break;
      case 2: v = minDistToPoints(a[0], a[1], a[2], this.pts, this.count); break;
      case 3: v = <f32>nearestPointIndex(a[0], a[1], a[2], this.pts, this.count); break;
      case 4: v = pingPong(a[0]); break;
      case 5: v = mirror(a[0], a[1]); break;
      case 6: v = pulse(a[0], a[1], a[2], a[3]); break;
      case 7: v = ease(<i32>a[0], a[1]); break;
      case 8: v = crossingTimeLine(a[0], a[1], a[2], a[3]); break;
      case 9: v = crossingTimeLoop(a[0], a[1], a[2], a[3], a[4]); break;
      case 10: v = <f32>crossingCount(a[0], a[1], a[2], a[3], a[4]); break;
      case 11: v = envelope(a[0], a[1], a[2]); break;
    }
    out.set(0, v);
  }
}
register(new M());
`;

const MANIFEST: ContentPluginManifest = {
  schema: 1,
  kind: 'modifier',
  alias: '@test/patterns',
  name: 'Patterns',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  description: 'Evaluates SDK pattern helpers for tests.',
  signatures: ['scalar'],
  output: 'bipolar',
  params: [{ key: 'sel', type: 'number', min: 0, max: 100, default: 0, label: 'Selector' }],
};

let inst: PluginInstance;

/** Runs helper `sel` with `args` (and optional points) inside the plugin. */
function run(sel: number, args: number[], pts: number[] = [], count = pts.length / 2): number {
  const params = new Float32Array(26);
  params[0] = sel;
  args.forEach((v, i) => { params[1 + i] = v; });
  params[9] = count;
  pts.forEach((v, i) => { params[10 + i] = v; });
  inst.prepare(params);
  const ctx = new Float32Array(CTX_FIELDS);
  ctx[CTX.arity] = 1;
  return inst.render(ctx, new Float32Array(SAMPLE_FIELDS), 1)[0]!;
}

// ── TS references ────────────────────────────

const fract = (v: number) => v - Math.floor(v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const refDist2 = (x: number, y: number, px: number, py: number, k: number) => Math.hypot((x - px) * k, y - py);
const refDist3 = (x: number, y: number, z: number, px: number, py: number, pz: number, k: number, zs: number) =>
  Math.hypot((x - px) * k, y - py, (z - pz) * zs);
function refPoints(x: number, y: number, k: number, pts: number[], count: number): [number, number] {
  const n = Math.max(0, Math.min(count, 8, Math.floor(pts.length / 2)));
  let best = 1e9;
  let idx = -1;
  for (let i = 0; i < n; i++) {
    const d = refDist2(x, y, pts[2 * i]!, pts[2 * i + 1]!, k);
    if (idx < 0 || d < best) { best = d; idx = i; }
  }
  return [best, idx];
}
const refPingPong = (t: number) => 1 - Math.abs(2 * fract(t) - 1);
function refPulse(d: number, c: number, w: number, soft: number): number {
  if (w <= 0) return 0;
  const half = w / 2;
  const dd = Math.abs(d - c);
  if (dd >= half) return 0;
  const inner = half * (1 - Math.min(1, Math.max(0, soft)));
  return dd <= inner ? 1 : 1 - smooth((dd - inner) / (half - inner));
}
function refEase(kind: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (kind) {
    case 1: return t * t;
    case 2: return 1 - (1 - t) ** 2;
    case 3: return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    case 4: return 2 ** (10 * t - 10);
    case 5: return 1 - 2 ** (-10 * t);
    case 6: return (1 - Math.cos(Math.PI * t)) / 2;
    case 7: return smooth(t);
    default: return t;
  }
}
function refLine(a0: number, va: number, b0: number, vb: number): number {
  const dv = va - vb;
  if (dv === 0) return b0 === a0 ? 0 : -1;
  const t = (b0 - a0) / dv;
  return t >= 0 ? t : -1;
}
function refLoop(a0: number, va: number, b0: number, vb: number, t: number): number {
  const dv = va - vb;
  const k = a0 - b0 + dv * t;
  if (dv === 0) return fract(k) === 0 ? 0 : -1;
  return dv > 0 ? fract(k) / dv : fract(-k) / -dv;
}
function refCount(a0: number, va: number, b0: number, vb: number, t: number): number {
  const dv = va - vb;
  if (t <= 0 || dv === 0) return 0;
  const k0 = a0 - b0;
  const k1 = k0 + dv * t;
  return dv > 0 ? Math.floor(k1) - Math.floor(k0) : Math.floor(-k1) - Math.floor(-k0);
}
function refEnvelope(ms: number, att: number, dec: number): number {
  if (ms < 0) return 0;
  const a = Math.max(0, att);
  if (ms < a) return ms / a;
  const dt = ms - a;
  return dec <= 0 || dt >= dec ? 0 : 1 - dt / dec;
}

// ── Tests ────────────────────────────────────

const TOL = 1e-4;
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(TOL);

describe('SDK pattern helpers', () => {
  beforeAll(async () => {
    const { pkg, diagnostics } = await buildPackage(MANIFEST, { 'modifier.ts': SOURCE });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
  }, 60_000);

  it('dist2 / dist3 apply aspect and zScale', () => {
    for (const a of [[0.1, 0.2, 0.5, 0.5, 1], [0.1, 0.2, 0.5, 0.5, 2.5], [0.9, 0.1, 0.2, 0.7, 0.5], [0.3, 0.3, 0.3, 0.3, 3]]) {
      near(run(SEL.dist2, a), refDist2(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!));
    }
    near(run(SEL.dist2, [0, 0, 0.3, 0.4, 1]), 0.5);
    for (const a of [[0.1, 0.2, 0.3, 0.5, 0.5, 0.9, 1, 1], [0.1, 0.2, 0.3, 0.5, 0.5, 0.9, 2, 0.5], [0.1, 0.2, 0.3, 0.5, 0.5, 0.9, 1, 0]]) {
      near(run(SEL.dist3, a), refDist3(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!, a[7]!));
    }
  });

  it('minDistToPoints / nearestPointIndex incl. clamping and no points', () => {
    const pts = [0.1, 0.1, 0.8, 0.2, 0.5, 0.9, 0.3, 0.6];
    for (const [x, y, k] of [[0.2, 0.2, 1], [0.7, 0.3, 2], [0.45, 0.8, 1], [0.35, 0.55, 0.5]] as const) {
      const [d, i] = refPoints(x, y, k, pts, 4);
      near(run(SEL.minDist, [x, y, k], pts), d);
      expect(run(SEL.nearest, [x, y, k], pts)).toBe(i);
    }
    // count 0 and negative → no point
    expect(run(SEL.minDist, [0.5, 0.5, 1], pts, 0)).toBe(1e9);
    expect(run(SEL.nearest, [0.5, 0.5, 1], pts, 0)).toBe(-1);
    expect(run(SEL.nearest, [0.5, 0.5, 1], pts, -3)).toBe(-1);
    // count above 8 is clamped to 8 (all 16 slots are points)
    const many = Array.from({ length: 16 }, (_, i) => ((i * 37) % 17) / 17);
    const [d8, i8] = refPoints(0.4, 0.6, 1, many, 8);
    near(run(SEL.minDist, [0.4, 0.6, 1], many, 20), d8);
    expect(run(SEL.nearest, [0.4, 0.6, 1], many, 20)).toBe(i8);
  });

  it('pingPong (incl. negatives) and mirror', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1, 1.3, -0.25, -1.6, 7.9]) near(run(SEL.pingPong, [t]), refPingPong(t));
    near(run(SEL.pingPong, [0.5]), 1);
    near(run(SEL.pingPong, [-0.25]), 0.5);
    near(run(SEL.mirror, [0.2, 0.5]), 0.3);
    near(run(SEL.mirror, [0.8, 0.5]), 0.3);
    near(run(SEL.mirror, [0.1, -0.4]), 0.5);
  });

  it('pulse: hard, soft, partial softness and zero width', () => {
    const cases = [
      [0.5, 0.5, 0.2, 0], [0.55, 0.5, 0.2, 0], [0.61, 0.5, 0.2, 0],
      [0.5, 0.5, 0.2, 1], [0.53, 0.5, 0.2, 1], [0.47, 0.5, 0.2, 1], [0.6, 0.5, 0.2, 1],
      [0.52, 0.5, 0.2, 0.5], [0.58, 0.5, 0.2, 0.5], [0.58, 0.5, 0.2, 2],
      [0.5, 0.5, 0, 0.5], [0.5, 0.5, -1, 0.5],
    ];
    for (const a of cases) near(run(SEL.pulse, a), refPulse(a[0]!, a[1]!, a[2]!, a[3]!));
    expect(run(SEL.pulse, [0.5, 0.5, 0, 0.5])).toBe(0);
    expect(run(SEL.pulse, [0.5, 0.5, 0.2, 1])).toBe(1);
  });

  it('ease: every kind, exact endpoints, clamping, unknown = linear', () => {
    for (let kind = 0; kind <= 7; kind++) {
      expect(run(SEL.ease, [kind, 0])).toBe(0);
      expect(run(SEL.ease, [kind, 1])).toBe(1);
      expect(run(SEL.ease, [kind, -0.5])).toBe(0);
      expect(run(SEL.ease, [kind, 1.5])).toBe(1);
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.95]) near(run(SEL.ease, [kind, t]), refEase(kind, t));
    }
    near(run(SEL.ease, [42, 0.3]), 0.3);
  });

  it('crossingTimeLine: future, past and parallel', () => {
    const cases = [[0, 1, 1, 0], [0, 0.5, 1, -0.5], [1, 1, 0, 0], [0, 1, 1, 1], [0.3, 2, 0.3, 2], [2, -1, 0, 1]];
    for (const a of cases) near(run(SEL.lineTime, a), refLine(a[0]!, a[1]!, a[2]!, a[3]!));
    expect(run(SEL.lineTime, [0, 1, 1, 1])).toBe(-1);
    expect(run(SEL.lineTime, [1, 1, 0, 0])).toBe(-1);
    near(run(SEL.lineTime, [0, 0.5, 1, -0.5]), 1);
  });

  it('crossingTimeLoop / crossingCount on the unit loop', () => {
    const cases = [
      [0, 0.3, 0.5, -0.2, 0.2], [0, 0.3, 0.5, -0.2, 1.3], [0, 0.3, 0.5, -0.2, 2.7],
      [0.1, -0.4, 0.6, 0.1, 0.4], [0.1, -0.4, 0.6, 0.1, 3.3], [0.2, 1.5, 0.9, 0.25, 5.1],
      [0, 0.3, 0.5, -0.2, -0.7],
    ];
    for (const a of cases) {
      near(run(SEL.loopTime, a), refLoop(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!));
      expect(run(SEL.loopCount, a)).toBe(refCount(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!));
    }
    // relative speed 0.5 → period 2; first meeting at t = 1
    near(run(SEL.loopTime, [0, 0.3, 0.5, -0.2, 1.4]), 0.4);
    expect(run(SEL.loopCount, [0, 0.3, 0.5, -0.2, 0.9])).toBe(0);
    expect(run(SEL.loopCount, [0, 0.3, 0.5, -0.2, 1.4])).toBe(1);
    expect(run(SEL.loopCount, [0, 0.3, 0.5, -0.2, 3.4])).toBe(2);
    // equal speeds: never (different starts) / always (same start)
    expect(run(SEL.loopTime, [0.1, 0.4, 0.6, 0.4, 2])).toBe(-1);
    expect(run(SEL.loopTime, [0.25, 0.4, 0.25, 0.4, 2])).toBe(0);
    expect(run(SEL.loopCount, [0.1, 0.4, 0.6, 0.4, 2])).toBe(0);
  });

  it('envelope phases and degenerate attack/decay', () => {
    const cases = [
      [-5, 100, 200], [0, 100, 200], [50, 100, 200], [100, 100, 200], [200, 100, 200], [300, 100, 200], [400, 100, 200],
      [0, 0, 200], [50, 0, 200], [50, 100, 0], [100, 100, 0], [0, 0, 0],
    ];
    for (const a of cases) near(run(SEL.envelope, a), refEnvelope(a[0]!, a[1]!, a[2]!));
    near(run(SEL.envelope, [50, 100, 200]), 0.5);
    near(run(SEL.envelope, [200, 100, 200]), 0.5);
    expect(run(SEL.envelope, [0, 0, 200])).toBe(1);
    expect(run(SEL.envelope, [-1, 0, 200])).toBe(0);
  });
});
