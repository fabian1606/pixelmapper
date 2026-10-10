/**
 * Per-sample distribution values (plan §1.2, M3.6): TS port of
 * `rs-engine/core/src/distribution.rs`. Used by previews; parity with the
 * core is tested on a shared table (`sample.test.ts` ↔ `distribution.rs`).
 */
import type { Distribution } from '@pixelmapper/extension-api';

/** Ranks used for grouping linear/radial/conical (spatial quantized to 16 steps). */
export const QUANTIZED_RANKS = 16;

/** One sample's input. */
export interface DistributionSampleInput {
  /** Normalized world position. */
  x: number;
  y: number;
  /** Order rank of the sample's fixture (−1 = none). */
  fixtureRank: number;
  /** Head index within the fixture and the fixture's head count. */
  head: number;
  headCount: number;
}

/** Per-sample output (ABI v1.1 sample slots 13–15). */
export interface DistributionSample {
  spatial: number;
  /** −1 when the mode has no ranks. */
  rank: number;
  /** −1 without grouping. */
  group: number;
}

/** mulberry32 step (u32), identical to the Rust port. */
function nextRandom(state: { s: number }): number {
  state.s = (state.s + 0x6d2b79f5) | 0;
  let t = Math.imul(state.s ^ (state.s >>> 15), 1 | state.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

const permCache = new Map<string, Uint32Array>();

/** Seeded Fisher–Yates permutation of 0..count (cached). */
export function permutation(count: number, seed: number): Uint32Array {
  const key = `${count}:${seed}`;
  let perm = permCache.get(key);
  if (perm) return perm;
  perm = new Uint32Array(count);
  for (let i = 0; i < count; i++) perm[i] = i;
  const state = { s: seed | 0 };
  for (let i = count - 1; i > 0; i--) {
    const j = nextRandom(state) % (i + 1);
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  if (permCache.size > 64) permCache.clear();
  permCache.set(key, perm);
  return perm;
}

/** Wraps to [0, 1). */
const wrap01 = (v: number) => v - Math.floor(v);

/** Spatial position of a point for the gradient modes. */
function gradientSpatial(d: Distribution, x: number, y: number): number {
  const ex = d.end.x - d.origin.x;
  const ey = d.end.y - d.origin.y;
  const len = Math.max(Math.hypot(ex, ey), 1e-4);
  const px = x - d.origin.x;
  const py = y - d.origin.y;
  switch (d.mode) {
    case 'linear': return (px * ex + py * ey) / (len * len);
    case 'radial': return Math.hypot(px, py) / len;
    case 'conical': return wrap01((Math.atan2(py, px) - Math.atan2(ey, ex)) / (2 * Math.PI));
    default: return 0;
  }
}

/** Grouping is active (kind set and n ≥ 1). */
export const hasGrouping = (d: Distribution) => d.grouping.kind !== 'none' && d.grouping.n >= 1;

/** Group of `rank` among `count` ranks (grouping must be active). */
export function groupOf(d: Distribution, rank: number, count: number): number {
  const n = Math.floor(d.grouping.n);
  switch (d.grouping.kind) {
    case 'everyN': return rank % n;
    case 'sections': return Math.min(n - 1, Math.floor((rank * n) / count));
    case 'random': return permutation(count, d.grouping.seed)[rank]! % n;
    default: return -1;
  }
}

/**
 * Computes `spatial`, `rank` and `distGroup` of one sample. `rankCount` is
 * the number of order ranks of the instance (0 when none).
 */
export function sampleDistribution(d: Distribution, rankCount: number, s: DistributionSampleInput): DistributionSample {
  let spatial = 0;
  let rank = -1;
  let count = 0;
  const heads = Math.max(1, s.headCount);

  if (d.scope === 'within') {
    rank = s.head;
    count = heads;
    spatial = d.withinOffset === 'order' && s.fixtureRank >= 0 && rankCount > 0
      ? (s.fixtureRank + s.head / heads) / rankCount
      : s.head / heads;
  }
  else if (d.mode === 'order') {
    if (s.fixtureRank >= 0 && rankCount > 0) {
      rank = s.fixtureRank;
      count = rankCount;
      spatial = rank / count;
    }
  }
  else if (d.mode !== 'none') {
    spatial = gradientSpatial(d, s.x, s.y);
  }

  let group = -1;
  if (hasGrouping(d)) {
    if (d.scope === 'across' && (d.mode === 'linear' || d.mode === 'radial' || d.mode === 'conical')) {
      rank = Math.min(QUANTIZED_RANKS - 1, Math.floor(Math.max(0, Math.min(1, spatial)) * QUANTIZED_RANKS));
      count = QUANTIZED_RANKS;
    }
    if (rank >= 0 && count > 0) {
      group = groupOf(d, rank, count);
      spatial = group / Math.floor(d.grouping.n);
    }
  }

  if (d.reverse) spatial = 1 - spatial;
  return { spatial, rank, group };
}

/**
 * Frame-level counts (ABI v1.1 frame slots 9–10): `rankCount` (order ranks,
 * the largest head count for scope within, 16 when gradient modes are
 * grouped, else 0) and `distGroupCount` (n with grouping, else 0).
 */
export function frameCounts(d: Distribution, rankCount: number, maxHeads: number): { rankCount: number; distGroupCount: number } {
  let rc = 0;
  if (d.scope === 'within') rc = Math.max(1, maxHeads);
  else if (d.mode === 'order') rc = rankCount;
  else if (d.mode !== 'none' && hasGrouping(d)) rc = QUANTIZED_RANKS;
  return { rankCount: rc, distGroupCount: hasGrouping(d) && rc > 0 ? Math.floor(d.grouping.n) : 0 };
}
