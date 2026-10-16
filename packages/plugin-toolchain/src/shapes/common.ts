/**
 * Helpers shared by the built-in curve shapes (plan §3.1): math, the
 * `peak`/`floor` level args every shape has, and the `repeat` stepper.
 */
import type { CurveDomain, ShapeArgDef } from '@pixelmapper/extension-api';

/** Clamps to [0, 1]. */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Clamps to [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Fractional part (always ≥ 0). */
export const fract = (v: number) => v - Math.floor(v);

/** Hermite smoothstep from `a` to `b` (step when a ≥ b). */
export function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Position within a centered period: fract(x·repeat + ½) − ½ ∈ [−½, ½). */
export const centered = (x: number, repeat: number) => fract(x * repeat + 0.5) - 0.5;

/** Distance behind the head in periods: fract(−x·repeat) ∈ [0, 1). */
export const behind = (x: number, repeat: number) => fract(-x * repeat);

/** Applies the level args: `floor + (peak − floor) · core`. */
export const level = (args: Record<string, number>, core: number) =>
  clamp01((args.floor ?? 0) + ((args.peak ?? 1) - (args.floor ?? 0)) * clamp01(core));

/** Grip x of the level lines (right side for peak, left for floor). */
function gripX(domain: CurveDomain, side: 'left' | 'right'): number {
  if (domain === 'signed') return side === 'right' ? 0.8 : -0.8;
  return side === 'right' ? 0.9 : 0.1;
}

/** The `peak` and `floor` args (lineY handles), shared by every shape. */
export function levelArgs(domain: CurveDomain): ShapeArgDef[] {
  return [
    {
      key: 'peak', label: 'Peak', min: 0, max: 1, default: 1, step: 0.01,
      handle: { kind: 'lineY', anchor: a => ({ x: gripX(domain, 'right'), y: a.peak ?? 1 }), drag: (_, p) => p.y },
    },
    {
      key: 'floor', label: 'Floor', min: 0, max: 1, default: 0, step: 0.01,
      handle: { kind: 'lineY', anchor: a => ({ x: gripX(domain, 'left'), y: a.floor ?? 0 }), drag: (_, p) => p.y },
    },
  ];
}

/** The `repeat` arg (stepper, no handle). */
export const repeatArg: ShapeArgDef = {
  key: 'repeat', label: 'Repeat', min: 1, max: 32, default: 1, step: 1,
  handle: { kind: 'none', anchor: () => ({ x: 0, y: 0 }), drag: a => a.repeat ?? 1 },
};
