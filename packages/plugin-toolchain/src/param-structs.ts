/**
 * Structured param types (plan §1.5, M7.1, M8.1): `gradient` and `steps` —
 * normalization, wire encoding and value validation.
 */
import type { GradientValue, StepsValue } from '@pixelmapper/extension-api';

/** Max stops of a gradient; max groups/steps of a step grid. */
export const GRADIENT_MAX_STOPS = 8;
export const STEPS_MAX_GROUPS = 8;
export const STEPS_MAX_STEPS = 16;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Stops sorted by position, clamped, at most 8 (empty → one black stop). */
export function normalizeGradient(v: GradientValue | undefined): GradientValue {
  const stops = (v?.stops ?? [])
    .filter(s => s && isNum(s.pos) && s.color)
    .map(s => ({ pos: clamp01(s.pos), color: { r: clamp01(s.color.r), g: clamp01(s.color.g), b: clamp01(s.color.b) } }))
    .sort((a, b) => a.pos - b.pos)
    .slice(0, GRADIENT_MAX_STOPS);
  return { stops: stops.length ? stops : [{ pos: 0, color: { r: 0, g: 0, b: 0 } }] };
}

/** Wire form: `count, (pos, r, g, b) × 8` (unused stops zero). */
export function writeGradient(buf: Float32Array, offset: number, v: GradientValue | undefined): void {
  const { stops } = normalizeGradient(v);
  buf[offset] = stops.length;
  stops.forEach((s, i) => buf.set([s.pos, s.color.r, s.color.g, s.color.b], offset + 1 + i * 4));
}

/** Wire form: `groups, steps, mask[16]` with bit `g` of `mask[s]` = cell (s, g). */
export function writeSteps(buf: Float32Array, offset: number, v: StepsValue | undefined): void {
  const groups = Math.max(1, Math.min(STEPS_MAX_GROUPS, Math.round(v?.groups ?? 1)));
  const steps = Math.max(1, Math.min(STEPS_MAX_STEPS, Math.round(v?.steps ?? 1)));
  buf[offset] = groups;
  buf[offset + 1] = steps;
  for (let s = 0; s < steps; s++) {
    let mask = 0;
    for (let g = 0; g < groups; g++) if (v?.cells?.[s]?.[g]) mask |= 1 << g;
    buf[offset + 2 + s] = mask;
  }
}

/** Error message for an invalid gradient, else null. */
export function checkGradient(v: unknown): string | null {
  const stops = (v as GradientValue | null)?.stops;
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > GRADIENT_MAX_STOPS) return `must have 1–${GRADIENT_MAX_STOPS} stops`;
  if (stops.some(s => !isUnit(s?.pos) || !isUnit(s?.color?.r) || !isUnit(s?.color?.g) || !isUnit(s?.color?.b))) return 'stops need pos and color { r, g, b } in 0–1';
  return null;
}

/** Error message for an invalid step grid, else null. */
export function checkSteps(v: unknown): string | null {
  const s = v as StepsValue | null;
  if (!s || !Number.isInteger(s.groups) || s.groups < 1 || s.groups > STEPS_MAX_GROUPS) return `groups must be an integer 1–${STEPS_MAX_GROUPS}`;
  if (!Number.isInteger(s.steps) || s.steps < 1 || s.steps > STEPS_MAX_STEPS) return `steps must be an integer 1–${STEPS_MAX_STEPS}`;
  if (!Array.isArray(s.cells) || s.cells.length !== s.steps || s.cells.some(r => !Array.isArray(r) || r.length !== s.groups || r.some(c => typeof c !== 'boolean'))) {
    return 'cells must be [steps][groups] booleans';
  }
  return null;
}
