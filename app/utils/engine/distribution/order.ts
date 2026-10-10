/**
 * Fixture order (plan M3.2, pure): projection clustering, rank resolution
 * and the click-tool semantics. Ranks are resolved here and sent to the core
 * as a complete table; the core only looks them up.
 */
import type { Distribution, Vec2 } from '@pixelmapper/extension-api';
import { analyzeSelection } from './selection-shape';

/** A fixture as seen by rank resolution. */
export interface OrderPoint {
  id: string | number;
  x: number;
  y: number;
}

/** Ranks by fixture id (string keys) and the number of distinct ranks. */
export interface ResolvedRanks {
  ranks: Record<string, number>;
  rankCount: number;
}

/** Signed (or mirrored) projection of `p` on the line a → b, in world units. */
function project(p: Vec2, a: Vec2, b: Vec2, mirror: boolean): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const u = len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
  const d = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  return mirror ? Math.abs(d) : d;
}

/** Median of the gaps > 1e-6 between sorted values (fallback 1). */
function medianGap(sorted: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!;
    if (g > 1e-6) gaps.push(g);
  }
  if (gaps.length === 0) return 1;
  gaps.sort((x, y) => x - y);
  const m = gaps.length >> 1;
  return gaps.length % 2 ? gaps[m]! : (gaps[m - 1]! + gaps[m]!) / 2;
}

/**
 * Clusters projections into ranks: a new rank starts when a value is more
 * than `tolerance` past the first value of the current cluster (anchoring at
 * the cluster start keeps chains of small gaps from merging everything).
 */
function cluster(entries: { key: string; p: number }[], tolerance: number): Record<string, number> {
  const sorted = [...entries].sort((x, y) => x.p - y.p);
  const out: Record<string, number> = {};
  let rank = 0;
  let start = sorted[0]?.p ?? 0;
  for (const e of sorted) {
    if (e.p - start > tolerance) {
      rank++;
      start = e.p;
    }
    out[e.key] = rank;
  }
  return out;
}

/**
 * Ranks by projection onto the line a → b: sort, then cluster with a
 * tolerance of `snap` × the median spacing. `mirror` ranks by the distance
 * from `a` on both sides.
 */
export function projectionRanks(points: readonly OrderPoint[], a: Vec2, b: Vec2, snap: number, mirror = false): Record<string, number> {
  const entries = points.map(pt => ({ key: String(pt.id), p: project(pt, a, b, mirror) }));
  const median = medianGap(entries.map(e => e.p).sort((x, y) => x - y));
  return cluster(entries, Math.max(0, snap) * median);
}

/** Renumbers ranks to 0..n−1, preserving order and equality. */
export function compactRanks(ranks: Record<string, number>): ResolvedRanks {
  const distinct = [...new Set(Object.values(ranks))].sort((x, y) => x - y);
  const index = new Map(distinct.map((r, i) => [r, i]));
  const out: Record<string, number> = {};
  for (const [k, r] of Object.entries(ranks)) out[k] = index.get(r)!;
  return { ranks: out, rankCount: distinct.length };
}

/**
 * Ranks of the targeted fixtures: explicit `order.ranks` first; fixtures
 * without one by projection on `order.line` (or the selection's main axis
 * when no line was drawn) — joining an explicit rank whose projection lies
 * within the snap tolerance, else appended after the explicit ranks in
 * projection order. Finally compacted to 0..n−1.
 */
export function resolveRanks(dist: Pick<Distribution, 'order'>, fixtures: readonly OrderPoint[]): ResolvedRanks {
  if (fixtures.length === 0) return { ranks: {}, rankCount: 0 };
  const { order } = dist;
  const explicit: Record<string, number> = {};
  const rest: OrderPoint[] = [];
  for (const f of fixtures) {
    const r = order.ranks[String(f.id)];
    if (typeof r === 'number' && Number.isFinite(r)) explicit[String(f.id)] = r;
    else rest.push(f);
  }
  if (rest.length > 0) {
    const line = order.line ?? analyzeSelection(fixtures).axis;
    const mirror = !!order.mirror;
    if (Object.keys(explicit).length === 0) {
      Object.assign(explicit, projectionRanks(rest, line.a, line.b, order.snap, mirror));
    }
    else {
      const proj = new Map(fixtures.map(f => [String(f.id), project(f, line.a, line.b, mirror)]));
      const tolerance = Math.max(0, order.snap) * medianGap([...proj.values()].sort((x, y) => x - y));
      const known = Object.entries(explicit).map(([k, r]) => ({ r, p: proj.get(k)! }));
      const unmatched: { key: string; p: number }[] = [];
      for (const f of rest) {
        const key = String(f.id);
        const p = proj.get(key)!;
        const near = known
          .filter(k => Math.abs(k.p - p) <= tolerance)
          .sort((x, y) => Math.abs(x.p - p) - Math.abs(y.p - p))[0];
        if (near) explicit[key] = near.r;
        else unmatched.push({ key, p });
      }
      const base = Math.max(...Object.values(explicit)) + 1;
      for (const [k, r] of Object.entries(cluster(unmatched, tolerance))) explicit[k] = base + r;
    }
  }
  return compactRanks(explicit);
}

/** State of a click-tool session. */
export interface ClickResult {
  ranks: Record<string, number>;
  /** Rank given by the last click (null before the first click). */
  last: number | null;
}

/**
 * Click tool: a click assigns the next rank (0 on the first click of a
 * session); Shift-click assigns the same rank as the previous click. Clicking
 * an already ranked fixture moves it to the next rank.
 */
export function clickRank(ranks: Record<string, number>, id: string | number, shift: boolean, last: number | null): ClickResult {
  const r = shift ? (last ?? 0) : (last === null ? 0 : last + 1);
  return { ranks: { ...ranks, [String(id)]: r }, last: r };
}
