/**
 * Geometry of the `pm.curve` editor (plan M2.3): editor space (domain x,
 * value y) ↔ SVG/percent coordinates, ticks and tick snapping.
 */
import type { CurveAxis, CurveDomain } from '@pixelmapper/extension-api';
import { domainT, domainX } from '~/utils/params/curve-shapes';

/** SVG view box (stretched to the element with `preserveAspectRatio="none"`). */
export const SVG_W = 240;
export const SVG_H = 72;
/** Vertical padding so values 0 and 1 stay visible. */
export const PAD_Y = 6;
/** Editor heights by input size. */
export const HEIGHTS = { sm: 56, md: 80, lg: 120 } as const;
/** Snap distance as a fraction of the tick spacing (same as the former WaveformEditor). */
export const SNAP_THRESHOLD = 0.35;
/** Handle colour (former WaveformEditor accent). */
export const ACCENT = '#eab308';

/** Value y (0–1) → SVG y. */
export const svgY = (y: number) => SVG_H - PAD_Y - y * (SVG_H - 2 * PAD_Y);

/** Domain x → SVG x. */
export const svgX = (domain: CurveDomain, x: number) => domainT(domain, x) * SVG_W;

/** Editor point → CSS position in percent of the editor box. */
export function percentOf(domain: CurveDomain, p: { x: number; y: number }): { left: string; top: string } {
  return { left: `${domainT(domain, p.x) * 100}%`, top: `${(svgY(p.y) / SVG_H) * 100}%` };
}

/** Pointer → editor point (domain x, value y), clamped to the box. */
export function pointerToEditor(e: { clientX: number; clientY: number }, rect: DOMRect, domain: CurveDomain): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
  const sy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * SVG_H;
  const y = Math.max(0, Math.min(1, (SVG_H - PAD_Y - sy) / (SVG_H - 2 * PAD_Y)));
  return { x: domainX(domain, t), y };
}

/**
 * Tick positions in domain units: `fixtures` → one per fixture (spacing
 * 1/ticks, both sides of 0 for signed domains); `beats` → 8 per beat over the
 * cycle; `none` → none.
 */
export function tickPositions(axis: CurveAxis, domain: CurveDomain, ticks: number): number[] {
  if (axis === 'none' || !(ticks > 0)) return [];
  const per = axis === 'beats' ? Math.round(ticks * 8) : Math.round(ticks);
  if (per <= 0 || per > 512) return [];
  const out: number[] = [];
  const lo = domain === 'signed' ? -per : 0;
  for (let k = lo; k <= per; k++) out.push(k / per);
  return out;
}

/** Snaps `x` to the nearest tick when within the snap threshold. */
export function snapToTicks(x: number, positions: readonly number[]): number {
  if (positions.length < 2) return x;
  const spacing = positions[1]! - positions[0]!;
  let best = x;
  let dist = Infinity;
  for (const p of positions) {
    const d = Math.abs(x - p);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return dist < spacing * SNAP_THRESHOLD ? best : x;
}

/** Polyline points of `f` over the domain (`samples` + 1 vertices). */
export function polylineOf(domain: CurveDomain, f: (x: number) => number, samples = 120, w = SVG_W): string {
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push(`${(t * w).toFixed(1)},${svgY(f(domainX(domain, t))).toFixed(1)}`);
  }
  return pts.join(' ');
}
