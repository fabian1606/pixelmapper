/**
 * Shared types of the observation pipeline (ADR 0002 §6, plan M2).
 *
 * A capture (`live` via `capture.ts`, `preview` via `preview.ts`) produces a
 * `Trace`: normalized signature values of every observed sample (fixture
 * head) at a fixed frame rate. The feature extractors (`features/*`) turn a
 * trace into JSON features, `report.ts` renders them as text.
 */
import type { Signature } from '~/utils/engine/types';

// ── Trace ───────────────────────────────────────

/** One observed sample: a fixture head (or the whole fixture in live mode). */
export interface TraceSample {
  fixtureId: string | number;
  fixtureName: string;
  /** Head index within the fixture and the fixture's head count (live: 0 / 1). */
  head: number;
  headCount: number;
  /** Normalized world position (like `Sample.x/y`) and height. */
  x: number;
  y: number;
  z: number;
  /** Ids of all groups containing the fixture (innermost first). */
  groupIds: Array<string | number>;
  /**
   * Preview only: position along the instance's spread (engine
   * `Sample.spatial`, ADR B6) and the order rank (−1 = none).
   */
  spatial?: number;
  rank?: number;
}

/** Which modifier produced a preview trace (report `sources`). */
export interface TraceSource {
  modifierId?: string;
  pluginHash: string;
  pluginAlias?: string;
  output: 'bipolar' | 'absolute' | 'scale';
  blend: string;
  strength: number;
  /** Spread kind of the distribution (ABI `spread`). */
  spread: 'none' | 'spatial' | 'order' | 'within';
}

/** A point of interest for radial analysis (from point params or the request). */
export interface TracePoint {
  /** Param key or `p0`, `p1`, … for request points. */
  key: string;
  x: number;
  y: number;
}

/** Captured values of one observation window. */
export interface Trace {
  mode: 'live' | 'preview';
  signature: Signature;
  /** Values per frame and sample: scalar 1, panTilt 2, rgb 3. */
  arity: number;
  fps: number;
  /** Window start (s, relative: preview t = 0 is the clock epoch, live = now). */
  fromS: number;
  durationS: number;
  bpm: number;
  /** Frame times in seconds (absolute engine time for preview, relative to capture start for live). */
  times: Float64Array;
  samples: TraceSample[];
  /**
   * `values[s]` holds sample `s`: `frameCount × arity` values in 0–1,
   * frame-major (`values[s][f * arity + c]`). NaN = unavailable.
   */
  values: Float32Array[];
  /** Preview: the rendered modifier. */
  source?: TraceSource;
  /** Points for radial analysis. */
  points?: TracePoint[];
  /** Preview: the distribution handle (Spatial 2D axis). */
  handle?: { origin: { x: number; y: number }; end: { x: number; y: number } };
  /**
   * Mirror lines for the `mirror` feature (world x of the vertical line,
   * world y of the horizontal line); default: center of the samples.
   * `observe` sets the room center or the request's `mirror`.
   */
  mirrorAxes?: { x?: number; y?: number };
  /** Capture-level notes (e.g. fallbacks used), copied into findings. */
  notes?: string[];
}

/** Number of frames of a trace. */
export function frameCount(trace: Trace): number {
  return trace.times.length;
}

// ── Time references ─────────────────────────────

/**
 * Parses a `TimeRef` (`'2s'`, `'500ms'`, `'8 beats'`, or seconds) into
 * seconds; beats use `bpm`. Invalid input yields `fallback`.
 */
export function parseTimeRef(ref: string | number | undefined, bpm: number, fallback: number): number {
  if (ref === undefined) return fallback;
  if (typeof ref === 'number') return Number.isFinite(ref) && ref >= 0 ? ref : fallback;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|beats?)\s*$/.exec(ref);
  if (!m) return fallback;
  const n = Number(m[1]);
  if (m[2] === 'ms') return n / 1000;
  if (m[2] === 's') return n;
  return bpm > 0 ? (n * 60) / bpm : fallback;
}
