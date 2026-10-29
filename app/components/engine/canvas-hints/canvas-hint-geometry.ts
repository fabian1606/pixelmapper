/**
 * Canvas hints (plan M4), pure part: which handles a modifier shows on the
 * 2D canvas, and how a pointer position maps to param values.
 *
 * Coordinates are normalized world space: `x` over the world width, `y`
 * over the world height, both 0–1. A radius is in normalized world-x units
 * (1 = the world width), so a ring is a true circle on the canvas. Plugins
 * compare it against `hypot(dx, dy / worldAspect)` with
 * `worldAspect = worldWidth / worldHeight`.
 * TODO(ABI 1.3, WP-C): keep in sync with the `Frame.worldAspect` definition
 * and the SDK `dist2` helper once they land.
 */
import { paramCanvasHint, type ParamSchema, type ParamValue, type Vec2 } from '@pixelmapper/extension-api';
import { matchWhen } from '~/components/plugin-host/param-form-layout';

// ── Handle model ─────────────────────────────────────────────────────────────

/** A draggable dot bound to a `point` param. */
export interface PointHandle {
  kind: 'point';
  /** Param key. */
  key: string;
  label: string;
  /** CSS color (undefined = theme primary). */
  color?: string;
  /** Current value (normalized world space). */
  value: Vec2;
}

/** A draggable ring bound to a `number` param, centered on a point param. */
export interface RadiusHandle {
  kind: 'radius';
  key: string;
  /** Key of the anchor point param. */
  anchor: string;
  label: string;
  color?: string;
  /** Anchor value (normalized world space). */
  center: Vec2;
  /** Current radius (normalized world-x units). */
  radius: number;
  min: number;
  max: number;
}

/** Any canvas handle. */
export type CanvasHandle = PointHandle | RadiusHandle;

/** A point-like value, or null. */
function asPoint(v: unknown): Vec2 | null {
  const p = v as Partial<Vec2> | null | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
}

/**
 * The handles of a modifier: one per hinted param that the card would show
 * (not `hidden`, `when` holds). Rings come first so dots draw above them.
 */
export function collectCanvasHandles(
  schema: ParamSchema,
  params: Record<string, ParamValue>,
  distributionMode?: string,
): CanvasHandle[] {
  const ctx = { params, distributionMode };
  const points: PointHandle[] = [];
  const rings: RadiusHandle[] = [];
  for (const p of schema) {
    const hint = paramCanvasHint(p.ui);
    if (!hint || (p.tier ?? 'primary') === 'hidden' || !matchWhen(p.when, schema, ctx)) continue;
    const label = hint.label ?? p.label;
    if (hint.canvas === 'point' && p.type === 'point') {
      const value = asPoint(params[p.key]) ?? asPoint(p.default);
      if (value) points.push({ kind: 'point', key: p.key, label, color: hint.color, value });
    } else if (hint.canvas === 'radius' && p.type === 'number') {
      const anchor = schema.find(a => a.key === hint.anchor && a.type === 'point');
      const center = anchor ? asPoint(params[anchor.key]) ?? asPoint(anchor.default) : null;
      if (!center) continue;
      const radius = Number(params[p.key] ?? p.default);
      rings.push({ kind: 'radius', key: p.key, anchor: hint.anchor, label, color: hint.color, center, radius, min: p.min, max: p.max });
    }
  }
  return [...rings, ...points];
}

// ── Pointer → value ──────────────────────────────────────────────────────────

/** Clamps to [lo, hi]. */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snap targets per axis (normalized) and the tolerance per axis (normalized). */
export interface SnapOptions {
  xs: number[];
  ys: number[];
  tolX: number;
  tolY: number;
}

/** Snaps one axis to the nearest target within tolerance. */
function snapAxis(v: number, targets: number[], tol: number): number {
  let best = v;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * Point value under the pointer: snapped per axis (edges, center and the
 * other handles' axes) when `snap` is given, then clamped to 0–1.
 */
export function pointFromPointer(p: Vec2, snap?: SnapOptions): Vec2 {
  const x = snap ? snapAxis(p.x, snap.xs, snap.tolX) : p.x;
  const y = snap ? snapAxis(p.y, snap.ys, snap.tolY) : p.y;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * Radius under the pointer in normalized world-x units:
 * `hypot(dx, dy / aspect)` with `aspect = worldWidth / worldHeight`,
 * clamped to the param's [min, max].
 */
export function radiusFromPointer(center: Vec2, p: Vec2, aspect: number, min: number, max: number): number {
  const r = Math.hypot(p.x - center.x, (p.y - center.y) / aspect);
  return clamp(r, min, max);
}

/** Snap targets for dragging point `key`: world edges, center, and the other points. */
export function snapTargets(handles: CanvasHandle[], key: string): { xs: number[]; ys: number[] } {
  const xs = [0, 0.5, 1];
  const ys = [0, 0.5, 1];
  for (const h of handles) {
    if (h.kind !== 'point' || h.key === key) continue;
    xs.push(h.value.x);
    ys.push(h.value.y);
  }
  return { xs, ys };
}
