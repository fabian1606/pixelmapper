/**
 * Curve values and programmatic curve shapes (plan M1.1, ADR A20).
 *
 * A curve param holds one of three value forms:
 * - programmatic `{ shape, args }`: a registered generator with arguments
 *   (every argument is a handle in `pm.curve`), exact and adjustable;
 * - free `{ points }`: user-edited points with per-point segment kinds and
 *   optional Bézier handles;
 * - legacy `CurvePoint[]`: Catmull-Rom spline through the points.
 *
 * Free and legacy points are normalized 0–1 on both axes over the param's
 * domain (`signed` maps point x 0–1 to −1…1). Shapes evaluate in domain
 * units. On the wire every form is a 128-value LUT sampled by the host.
 */
import type { CurvePoint } from './params';

/** x-range of a curve LUT: `cycle` = [0, 1], `signed` = [−1, 1] (profiles). */
export type CurveDomain = 'cycle' | 'signed';

/** Tick/snap context of a curve editor. */
export type CurveAxis = 'fixtures' | 'beats' | 'none';

/** y display of a curve editor (the wire stays 0–1). */
export type CurveRange = 'unipolar' | 'bipolar';

/** How the segment to the right of a free point is drawn. */
export type CurvePointKind = 'smooth' | 'corner' | 'linear' | 'step';

/** A Bézier handle offset relative to its point (normalized units). */
export interface CurveHandle {
  dx: number;
  dy: number;
}

/** One point of a free curve (normalized 0–1 over the domain). */
export interface CurvePointV2 {
  x: number;
  y: number;
  /** Segment kind to the right of this point. Default `smooth`. */
  kind?: CurvePointKind;
  /** Incoming Bézier handle (dx ≤ 0). Default: Catmull-Rom tangent, ⅓ segment. */
  in?: CurveHandle;
  /** Outgoing Bézier handle (dx ≥ 0). Default: Catmull-Rom tangent, ⅓ segment. */
  out?: CurveHandle;
}

/** Programmatic curve: a registered shape with its arguments. */
export interface CurveShapeValue {
  shape: string;
  args: Record<string, number>;
}

/** Free curve: user-edited points. */
export interface CurveFreeValue {
  points: CurvePointV2[];
}

/** Any curve value (programmatic, free, or legacy point list). */
export type CurveValue = CurveShapeValue | CurveFreeValue | CurvePoint[];

/** Context a shape evaluates in. */
export interface ShapeContext {
  /** Rank count of the instance (fixtures in order), 0 when unknown. */
  ticks: number;
}

/** A point in editor space: x in domain units, y in value units (0–1). */
export interface ShapePoint {
  x: number;
  y: number;
}

/** How the curve editor draws and drags one shape argument. */
export interface ShapeArgHandle {
  /**
   * - `edgeX`: double arrow on a flank, dragged horizontally;
   * - `pointOnEdge`: filled circle on the curve;
   * - `lineY`: full-width horizontal line with a grip, dragged vertically;
   * - `none`: no handle (the editor shows a stepper).
   */
  kind: 'edgeX' | 'pointOnEdge' | 'lineY' | 'none';
  /** Where the handle sits for the current args (editor space). */
  anchor: (args: Record<string, number>) => ShapePoint;
  /** Pointer position (editor space) → new argument value (clamped by the editor). */
  drag: (args: Record<string, number>, p: ShapePoint) => number;
  /** Snap the pointer to ticks (fixtures/beats) when the editor has an axis. */
  snap?: 'ticks' | 'none';
}

/** One argument of a shape. */
export interface ShapeArgDef {
  key: string;
  /** User-facing name (English), e.g. "Width". */
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  handle: ShapeArgHandle;
}

/** A programmatic curve generator. */
export interface ShapeDef {
  /** Registry id, e.g. `dot`. Extension shapes should be namespaced (`my-ext/zigzag`). */
  id: string;
  /** User-facing name (English). */
  label: string;
  domain: CurveDomain;
  /** True when the shape repeats (profiles wrap outside the domain). */
  periodic: boolean;
  args: ShapeArgDef[];
  /** y(x) in 0–1 for x in domain units; `ctx.ticks` = rank count. */
  evaluate: (x: number, args: Record<string, number>, ctx: ShapeContext) => number;
  /** Optional exact conversion to free points (else the editor samples). */
  toPoints?: (args: Record<string, number>, ctx: ShapeContext) => CurvePointV2[];
}

/** True for a programmatic curve value. */
export function isShapeCurve(v: unknown): v is CurveShapeValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as CurveShapeValue).shape === 'string';
}

/** True for a free curve value. */
export function isFreeCurve(v: unknown): v is CurveFreeValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as CurveFreeValue).points);
}
