/**
 * Synthetic traces for the feature / report tests.
 *
 * `makeTrace` samples a function `(sampleIndex, t) => values` at a fixed
 * frame rate; samples default to a row along x in [0, 1].
 */
import type { Signature } from '~/utils/engine/types';
import type { Trace, TracePoint, TraceSample, TraceSource } from '../types';

// ── Options ─────────────────────────────────────

/** Options of a synthetic trace. */
export interface SyntheticTraceOptions {
  /** Sample count (row along x) or explicit (partial) samples. */
  samples: number | Array<Partial<TraceSample>>;
  /** Values of sample `i` at time `t` (s, from 0); length = arity. */
  fn: (sampleIndex: number, t: number) => number[];
  signature?: Signature;
  fps?: number;
  duration?: number;
  bpm?: number;
  mode?: 'live' | 'preview';
  points?: TracePoint[];
  source?: TraceSource;
  notes?: string[];
}

/** Arity of a signature. */
function arityOf(signature: Signature): number {
  return signature === 'rgb' ? 3 : signature === 'panTilt' ? 2 : 1;
}

// ── Builders ────────────────────────────────────

/** Builds a trace by sampling `fn` for every sample and frame. */
export function makeTrace(opts: SyntheticTraceOptions): Trace {
  const signature = opts.signature ?? 'scalar';
  const arity = arityOf(signature);
  const fps = opts.fps ?? 30;
  const duration = opts.duration ?? 2;
  const frames = Math.round(duration * fps);
  const specs = typeof opts.samples === 'number' ? Array.from({ length: opts.samples }, () => ({})) : opts.samples;
  const n = specs.length;
  const samples: TraceSample[] = specs.map((s, i) => ({
    fixtureId: s.fixtureId ?? i + 1,
    fixtureName: s.fixtureName ?? `fx-${i + 1}`,
    head: s.head ?? 0,
    headCount: s.headCount ?? 1,
    x: s.x ?? (n > 1 ? i / (n - 1) : 0.5),
    y: s.y ?? 0,
    z: s.z ?? 0,
    groupIds: s.groupIds ?? [],
    ...(s.spatial !== undefined ? { spatial: s.spatial } : {}),
    ...(s.rank !== undefined ? { rank: s.rank } : {}),
  }));
  const times = Float64Array.from({ length: frames }, (_, f) => f / fps);
  const values = samples.map((_, i) => {
    const v = new Float32Array(frames * arity);
    for (let f = 0; f < frames; f++) {
      const out = opts.fn(i, times[f]!);
      for (let c = 0; c < arity; c++) v[f * arity + c] = out[c] ?? 0;
    }
    return v;
  });
  return {
    mode: opts.mode ?? 'preview',
    signature,
    arity,
    fps,
    fromS: 0,
    durationS: duration,
    bpm: opts.bpm ?? 120,
    times,
    samples,
    values,
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.points ? { points: opts.points } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  };
}

/** Deterministic PRNG (mulberry32) returning values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unipolar sine (0–1) of frequency `hz` with a phase offset in cycles. */
export function sine01(t: number, hz: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * (hz * t - phase));
}
