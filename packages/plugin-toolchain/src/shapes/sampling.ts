/**
 * Generic shape → free-points conversion (plan M2.5 fallback): dense
 * sampling, jump detection (discontinuities become `step` points) and
 * Ramer–Douglas–Peucker simplification into `linear` points. Keeps the LUT of
 * the converted curve within ±1e-2 of the shape.
 */
import type { CurvePointV2 } from '@pixelmapper/extension-api';

/** Samples over [0, 1] before simplification. */
const SAMPLES = 512;
/** Max deviation of the simplified polyline. */
const TOLERANCE = 2e-3;
/** A sample-to-sample change above this counts as a jump. */
const JUMP = 0.2;

/** Locates a discontinuity of `f` in [a, b] by bisection. */
function locateJump(f: (t: number) => number, a: number, b: number): number {
  const ya = f(a);
  for (let k = 0; k < 30; k++) {
    const m = (a + b) / 2;
    if (Math.abs(f(m) - ya) < JUMP / 2) a = m;
    else b = m;
  }
  return b;
}

/** RDP simplification of a polyline run (keeps both ends). */
function simplify(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let worst = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const t = (p.x - a.x) / Math.max(1e-12, b.x - a.x);
    const d = Math.abs(p.y - (a.y + (b.y - a.y) * t));
    if (d > worst) { worst = d; idx = i; }
  }
  if (worst <= TOLERANCE) return [a, b];
  return [...simplify(pts.slice(0, idx + 1)).slice(0, -1), ...simplify(pts.slice(idx))];
}

/** Converts `f` (t ∈ [0, 1] → 0–1) into free points. */
export function toPointsBySampling(f: (t: number) => number): CurvePointV2[] {
  // Split the samples into continuous runs at jumps.
  const runs: { x: number; y: number }[][] = [[]];
  let prev = { x: 0, y: f(0) };
  runs[0]!.push(prev);
  for (let i = 1; i <= SAMPLES; i++) {
    const x = i / SAMPLES;
    const cur = { x, y: f(x) };
    if (Math.abs(cur.y - prev.y) > JUMP) {
      const j = locateJump(f, prev.x, x);
      runs[runs.length - 1]!.push({ x: j - 1e-7, y: f(j - 1e-7) });
      runs.push([{ x: j, y: f(j) }]);
    }
    runs[runs.length - 1]!.push(cur);
    prev = cur;
  }
  const out: CurvePointV2[] = [];
  runs.forEach((run, r) => {
    const simple = simplify(run.filter((p, i) => i === 0 || p.x > run[i - 1]!.x));
    simple.forEach((p, i) => {
      // The last point of a run before a jump holds its value (step) until the next run.
      const last = i === simple.length - 1 && r < runs.length - 1;
      out.push({ x: p.x, y: Math.max(0, Math.min(1, p.y)), kind: last ? 'step' : 'linear' });
    });
  });
  return out;
}
