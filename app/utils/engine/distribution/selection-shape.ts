/**
 * Selection analysis (plan M3.3, pure): the shape of the edited fixtures,
 * used for selection-dependent defaults (main axis, ring, multi-head bars).
 */
import type { Vec2 } from '@pixelmapper/extension-api';

/** A fixture as seen by the analysis: center position and head count. */
export interface ShapePoint {
  x: number;
  y: number;
  /** Heads/pixels of the fixture (default 1). */
  heads?: number;
}

/** Result of `analyzeSelection`. */
export interface SelectionShape {
  count: number;
  centroid: Vec2;
  /** PCA main axis spanning the min..max projection, oriented +x (then +y). */
  axis: { a: Vec2; b: Vec2 };
  extentMain: number;
  extentCross: number;
  /** Mean distance to the centroid (ring radius). */
  radius: number;
  kind: 'single' | 'row' | 'ring' | 'area';
  /** Every fixture has ≥ 4 heads. */
  multiHead: boolean;
}

/** Main eigenvector of the 2×2 covariance, oriented +x then +y. */
function mainAxis(points: readonly ShapePoint[], c: Vec2): Vec2 {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Angle of the main axis of a symmetric 2×2 matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u = { x: Math.cos(theta), y: Math.sin(theta) };
  if (Math.abs(u.x) < 1e-9 ? u.y < 0 : u.x < 0) u = { x: -u.x, y: -u.y };
  return u;
}

/** Analyzes the shape of a fixture selection. */
export function analyzeSelection(fixtures: readonly ShapePoint[]): SelectionShape {
  const count = fixtures.length;
  const multiHead = count > 0 && fixtures.every(f => (f.heads ?? 1) >= 4);
  if (count === 0) {
    const c = { x: 0.5, y: 0.5 };
    return { count, centroid: c, axis: { a: { x: 0.4, y: 0.5 }, b: { x: 0.6, y: 0.5 } }, extentMain: 0, extentCross: 0, radius: 0, kind: 'single', multiHead };
  }
  const centroid = {
    x: fixtures.reduce((s, f) => s + f.x, 0) / count,
    y: fixtures.reduce((s, f) => s + f.y, 0) / count,
  };
  const u = mainAxis(fixtures, centroid);
  const v = { x: -u.y, y: u.x };
  let min = Infinity;
  let max = -Infinity;
  let cmin = Infinity;
  let cmax = -Infinity;
  for (const f of fixtures) {
    const dx = f.x - centroid.x;
    const dy = f.y - centroid.y;
    const pm = dx * u.x + dy * u.y;
    const pc = dx * v.x + dy * v.y;
    min = Math.min(min, pm);
    max = Math.max(max, pm);
    cmin = Math.min(cmin, pc);
    cmax = Math.max(cmax, pc);
  }
  const extentMain = max - min;
  const extentCross = cmax - cmin;
  const axis = {
    a: { x: centroid.x + u.x * min, y: centroid.y + u.y * min },
    b: { x: centroid.x + u.x * max, y: centroid.y + u.y * max },
  };

  const dists = fixtures.map(f => Math.hypot(f.x - centroid.x, f.y - centroid.y));
  const radius = dists.reduce((s, d) => s + d, 0) / count;
  const sd = Math.sqrt(dists.reduce((s, d) => s + (d - radius) ** 2, 0) / count);
  const cv = radius > 1e-9 ? sd / radius : Infinity;

  let kind: SelectionShape['kind'];
  if (count === 1 || extentMain < 1e-6) kind = 'single';
  else if (count >= 6 && cv < 0.15) kind = 'ring';
  else if (extentCross / extentMain < 0.15) kind = 'row';
  else kind = 'area';

  return { count, centroid, axis, extentMain, extentCross, radius, kind, multiHead };
}
