/**
 * JSON layout of an observation (ADR 0002 §6.3).
 *
 * `ObservationJson` is the subject of the observe expectations (dot paths
 * such as `group.temporal.kind` or `fixtures.*.issues`), so its shape is a
 * contract: plain, JSON-serializable objects with numbers rounded to ~4
 * significant digits.
 */
import type { Signature } from '~/utils/engine/types';

// ── Feature records ─────────────────────────────

/** Value statistics: min, max, mean, standard deviation. */
export interface Range {
  min: number;
  max: number;
  mean: number;
  sd: number;
}

/** Named color bucket of an rgb signal. */
export type ColorName =
  | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'magenta'
  | 'white' | 'black' | 'gray' | 'mixed';

/** Color statistics of an rgb signal (hue in degrees, circular stats). */
export interface Color {
  /** Shortest arc covering all hues (`min` > `max` when the arc wraps through 0°). */
  hue: { min: number; max: number; mean: number };
  sat: { mean: number };
  value: Range;
  name: ColorName;
}

/** Temporal verdict of a signal. */
export type Temporal =
  | { kind: 'constant' }
  | { kind: 'periodic'; hz: number; period: number; beats: number; beatLock: boolean; strength: number }
  | { kind: 'aperiodic'; band: [number, number] }
  | { kind: 'events'; on: number[]; off: number[] };

/** Spatial verdict of a set of samples. */
export type Spatial =
  | { kind: 'uniform' }
  | { kind: 'chase'; direction: [number, number]; step: number; speed?: number; axis: 'spread' | 'position' }
  | { kind: 'independent'; corr: number }
  | { kind: 'gradient'; direction: [number, number]; span: number }
  | { kind: 'constant' };

/** Radial propagation relative to points of interest. */
export interface Radial {
  from: Array<{ key: string; x: number; y: number }>;
  /** Pearson r of per-sample lag vs. distance to the nearest point (positive = outward). */
  r: number;
  /** World units per second (distance per lag). */
  speed: number;
  kind: 'outward' | 'inward' | 'none';
}

/** Mirror correlation across one mirror line. */
export interface MirrorAxis {
  /** Position of the mirror line (world x for `x`, world y for `y`). */
  at: number;
  /** Pearson r of the paired intensity series (1 = mirror images). */
  r: number;
  /** Samples that found a mirror partner (samples on the line excluded). */
  pairs: number;
}

/**
 * Mirror symmetry: `x` reflects across the vertical line (left ↔ right),
 * `y` across the horizontal line (front ↔ back). An axis is missing when
 * fewer than 2 samples have a mirror partner.
 */
export interface MirrorFeature {
  x?: MirrorAxis;
  y?: MirrorAxis;
}

/**
 * Compact features of one head (pixel / cell) of a fixture: intensity
 * range (no sd), time of the (first) peak and of the first onset (first
 * rising crossing of the group's mid level; missing when the head never
 * crosses it). Times in s relative to the window start.
 */
export interface HeadFeatures {
  range: { min: number; max: number; mean: number };
  peak: number;
  onset?: number;
}

/**
 * Onset order of a group: does light start one sample after the other?
 * `r` is the Pearson r of first-onset time vs. position along `axis`
 * (`spread` = rank / spatial of the instance, `layout` = fixture order,
 * then head); `cyclic` = fitted after rotating the order (a loop entered
 * mid-way). `direction`: `forward` (r ≥ 0.8, later along the axis),
 * `reverse` (r ≤ −0.8), `simultaneous` (all onsets within one frame),
 * `none`. `onsets` of `of` samples had an onset.
 */
export interface OnsetOrder {
  axis: 'spread' | 'layout';
  direction: 'forward' | 'reverse' | 'simultaneous' | 'none';
  r: number;
  cyclic: boolean;
  span: number;
  first: string;
  last: string;
  onsets: number;
  of: number;
}

/** Per-component features of a group. */
export interface ComponentFeatures {
  range: Range;
  temporal: Temporal;
}

/** Aggregated features over a set of samples. */
export interface GroupFeatures {
  /** Group name (only in `groups`, from the request). */
  name?: string;
  /** Number of fixtures. */
  count: number;
  /** Number of samples (heads). */
  samples: number;
  components: Record<string, ComponentFeatures>;
  range: Range;
  color?: Color;
  temporal: Temporal;
  spatial: Spatial;
  radial?: Radial;
  mirror?: MirrorFeature;
  /** Onset order over the samples (missing with < 2 onsets). */
  order?: OnsetOrder;
  /** Fraction of samples that are not constant. */
  active: number;
  issues: string[];
}

/**
 * Features of one fixture. `range` pools every head and frame: `max` is
 * the brightest head (so "every fixture reaches X" is
 * `fixtures.*.range.max`), `mean` the average over heads and frames;
 * "every pixel reaches X" is `fixtures.*.heads.*.range.max`. `temporal`
 * and `color` analyze the heads jointly; `issues` the head mean.
 */
export interface FixtureFeatures {
  name: string;
  x: number;
  y: number;
  /** Per head in head order (`heads.length` = head count). */
  heads: HeadFeatures[];
  range: Range;
  color?: Color;
  temporal: Temporal;
  issues: string[];
}

/** Source of a preview trace. */
export interface ObservationSource {
  plugin: string;
  hash: string;
  modifierId?: string;
  output: string;
  blend: string;
  strength: number;
  spread: string;
}

// ── Observation ─────────────────────────────────

/** Feature JSON of one observation. */
export interface ObservationJson {
  window: { from: number; duration: number; fps: number; frames: number; mode: 'live' | 'preview'; bpm: number };
  signature: Signature;
  sources: ObservationSource[];
  group: GroupFeatures;
  groups?: Record<string, GroupFeatures>;
  fixtures: Record<string, FixtureFeatures>;
  /**
   * `detail: 'raw'`: `fixtures.<id>[frame][component]` (head mean) and
   * `heads.<id>[head][frame][component]`.
   */
  raw?: { times: number[]; fixtures: Record<string, number[][]>; heads: Record<string, number[][][]> };
}

/** Options of `analyzeTrace`. */
export interface AnalyzeOptions {
  /** `raw` adds per-frame values; `fixture` only affects the text report. */
  detail?: 'group' | 'fixture' | 'raw';
  /** Groups to analyze separately (`json.groups[id]`). */
  groups?: Array<{ id: string | number; name: string; fixtureIds: Array<string | number> }>;
}
