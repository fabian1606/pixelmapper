/**
 * Pure edit operations on free curve points (plan M2.5). Points are
 * normalized 0–1 and sorted by x; the first and last point keep their x.
 */
import type { CurveHandle, CurvePointKind, CurvePointV2 } from '@pixelmapper/extension-api';
import { evaluatePoints, inHandle, isLegacyPoints, outHandle } from '~/utils/params/curve-shapes';

/** Minimum x distance between neighbouring points. */
export const MIN_GAP = 0.01;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Legacy points become explicit v2 points (smooth) so edits keep one model. */
export function normalizePoints(points: readonly CurvePointV2[]): CurvePointV2[] {
  return isLegacyPoints(points) ? points.map(p => ({ x: p.x, y: p.y, kind: 'smooth' as const })) : points.map(p => ({ ...p }));
}

/** Moves point `i` to (x, y); end points keep their x. */
export function movePoint(points: readonly CurvePointV2[], i: number, x: number, y: number): CurvePointV2[] {
  const out = normalizePoints(points);
  const p = out[i]!;
  const isEnd = i === 0 || i === out.length - 1;
  const nx = isEnd ? p.x : clamp(x, out[i - 1]!.x + MIN_GAP, out[i + 1]!.x - MIN_GAP);
  out[i] = { ...p, x: r3(nx), y: r3(clamp(y, 0, 1)) };
  return out;
}

/** Inserts a smooth point at x on the current curve; returns the points and the new index. */
export function insertPoint(points: readonly CurvePointV2[], x: number): { points: CurvePointV2[]; index: number } {
  const out = normalizePoints(points);
  const y = evaluatePoints(points, x);
  let index = out.findIndex(p => p.x > x);
  if (index <= 0) index = out.length;
  if (out.some(p => Math.abs(p.x - x) < MIN_GAP)) return { points: out, index: -1 };
  out.splice(index, 0, { x: r3(x), y: r3(y), kind: 'smooth' });
  return { points: out, index };
}

/** Removes an inner point (ends stay). */
export function removePoint(points: readonly CurvePointV2[], i: number): CurvePointV2[] {
  if (i <= 0 || i >= points.length - 1) return normalizePoints(points);
  return normalizePoints(points).filter((_, j) => j !== i);
}

/** Sets the segment kind of point `i` (handles reset when switching to linear/step). */
export function setKind(points: readonly CurvePointV2[], i: number, kind: CurvePointKind): CurvePointV2[] {
  const out = normalizePoints(points);
  const p = { ...out[i]!, kind };
  if (kind === 'linear' || kind === 'step') {
    delete p.in;
    delete p.out;
  }
  out[i] = p;
  return out;
}

/** The handles of point `i` as displayed (explicit or default). */
export function handlesOf(points: readonly CurvePointV2[], i: number): { in: CurveHandle | null; out: CurveHandle | null } {
  const pts = normalizePoints(points);
  return {
    in: i > 0 ? inHandle(pts, i) : null,
    out: i < pts.length - 1 ? outHandle(pts, i) : null,
  };
}

/**
 * Drags tangent `side` of point `i` to the handle offset `h`. A `smooth`
 * point keeps its handles collinear (the other side keeps its length);
 * `decouple` (Alt) turns the point into a `corner`.
 */
export function dragTangent(points: readonly CurvePointV2[], i: number, side: 'in' | 'out', h: CurveHandle, decouple: boolean): CurvePointV2[] {
  const out = normalizePoints(points);
  const cur = handlesOf(out, i);
  const p = { ...out[i]!, in: cur.in ?? undefined, out: cur.out ?? undefined };
  const fixed: CurveHandle = side === 'out' ? { dx: Math.max(0, h.dx), dy: h.dy } : { dx: Math.min(0, h.dx), dy: h.dy };
  p[side] = { dx: r3(fixed.dx), dy: r3(fixed.dy) };
  if (decouple) p.kind = 'corner';
  else if ((p.kind ?? 'smooth') === 'smooth') {
    const other = side === 'out' ? 'in' : 'out';
    const o = p[other];
    const len = Math.hypot(fixed.dx, fixed.dy);
    if (o && len > 1e-6) {
      const olen = Math.hypot(o.dx, o.dy);
      p[other] = { dx: r3((-fixed.dx / len) * olen), dy: r3((-fixed.dy / len) * olen) };
    }
  }
  out[i] = p;
  return out;
}
