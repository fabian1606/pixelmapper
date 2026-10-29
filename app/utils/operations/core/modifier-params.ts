/**
 * Validation of modifier param values against a plugin's param schema
 * (manifest `params`, ADR §6.2) for the `modifiers.*` operations.
 *
 * Returns readable problems (one string each) that name the key, the
 * expected type / range and the given value, so an AI can fix its input.
 */
import type { ParamDef, ParamSchema } from '@pixelmapper/extension-api';
import { isFreeCurve, isShapeCurve } from '@pixelmapper/extension-api';
import { getShape } from '@pixelmapper/plugin-toolchain/curve-shapes';

// ── Helpers ─────────────────────────────────────

/** Finite number check. */
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Plain object check. */
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Linear RGB color `{ r, g, b }` with channels 0–1. */
function isColor(v: unknown): boolean {
  return isObj(v) && ['r', 'g', 'b'].every(k => isNum(v[k]) && (v[k] as number) >= 0 && (v[k] as number) <= 1);
}

/** Short JSON of a value for messages. */
function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? `${s.slice(0, 57)}…` : String(s);
}

// ── Per type ────────────────────────────────────

/** Problem with one value, or null when valid. */
function checkValue(def: ParamDef, v: unknown): string | null {
  const where = `param "${def.key}" (${def.type})`;
  switch (def.type) {
    case 'number':
    case 'int':
      if (!isNum(v)) return `${where} must be a number, got ${show(v)}`;
      if (def.type === 'int' && !Number.isInteger(v)) return `${where} must be an integer, got ${v}`;
      if (v < def.min || v > def.max) return `${where} must be within ${def.min}–${def.max}, got ${v}`;
      return null;
    case 'angle':
      return isNum(v) ? null : `${where} must be a number in radians, got ${show(v)}`;
    case 'bool':
      return typeof v === 'boolean' ? null : `${where} must be true or false, got ${show(v)}`;
    case 'enum':
      return typeof v === 'string' && def.options.includes(v) ? null : `${where} must be one of ${def.options.join(', ')}; got ${show(v)}`;
    case 'color':
      return isColor(v) ? null : `${where} must be a linear RGB color { r, g, b } with channels 0–1, got ${show(v)}`;
    case 'point':
      return isObj(v) && isNum(v.x) && isNum(v.y) ? null : `${where} must be a point { x, y } (normalized 0–1), got ${show(v)}`;
    case 'curve':
      return checkCurve(def, v, where);
    case 'gradient': {
      const stops = isObj(v) ? v.stops : undefined;
      if (!Array.isArray(stops) || stops.length < 1 || stops.length > 8) return `${where} must be { stops: [{ pos 0–1, color { r, g, b } }] } with 1–8 stops, got ${show(v)}`;
      const bad = stops.find(s => !isObj(s) || !isNum(s.pos) || s.pos < 0 || s.pos > 1 || !isColor(s.color));
      return bad ? `${where}: invalid stop ${show(bad)} (pos 0–1, color { r, g, b } 0–1)` : null;
    }
    case 'steps': {
      if (!isObj(v) || !Number.isInteger(v.groups) || !Number.isInteger(v.steps) || !Array.isArray(v.cells)) {
        return `${where} must be { groups 1–8, steps 1–16, cells: boolean[step][group] }, got ${show(v)}`;
      }
      const groups = v.groups as number;
      const steps = v.steps as number;
      if (groups < 1 || groups > 8 || steps < 1 || steps > 16) return `${where}: groups must be 1–8 and steps 1–16, got ${groups}/${steps}`;
      const cells = v.cells as unknown[];
      const okCells = cells.length === steps && cells.every(row => Array.isArray(row) && row.length === groups && row.every(c => typeof c === 'boolean'));
      return okCells ? null : `${where}: cells must be ${steps} rows of ${groups} booleans`;
    }
    default:
      return null;
  }
}

/** Curve values: a registered (and offered) shape, free points, or legacy points. */
function checkCurve(def: Extract<ParamDef, { type: 'curve' }>, v: unknown, where: string): string | null {
  if (isShapeCurve(v)) {
    if (!getShape(v.shape)) return `${where}: unknown curve shape "${v.shape}"`;
    if (def.shapes && !def.shapes.includes(v.shape)) return `${where}: shape "${v.shape}" is not offered (use one of ${def.shapes.join(', ')})`;
    if (!isObj(v.args) || !Object.values(v.args).every(isNum)) return `${where}: shape args must be numbers by key`;
    return null;
  }
  if (isFreeCurve(v)) {
    if (def.allowFree === false) return `${where}: free curves are not allowed; use a shape (${(def.shapes ?? []).join(', ')})`;
    return v.points.every(p => isObj(p) && isNum(p.x) && isNum(p.y)) ? null : `${where}: points must be { x, y } numbers`;
  }
  if (Array.isArray(v) && v.every(p => isObj(p) && isNum(p.x) && isNum(p.y))) return null;
  return `${where} must be { shape, args } or { points: [{ x, y }] }, got ${show(v)}`;
}

// ── API ─────────────────────────────────────────

/**
 * Problems of `values` against `schema`: unknown keys and invalid values.
 * Missing keys are fine (defaults apply).
 */
export function paramProblems(schema: ParamSchema, values: Record<string, unknown>): string[] {
  const byKey = new Map(schema.map(d => [d.key, d]));
  const out: string[] = [];
  for (const [key, v] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      out.push(`unknown param "${key}" (known: ${schema.map(d => d.key).join(', ') || 'none'})`);
      continue;
    }
    const problem = checkValue(def, v);
    if (problem) out.push(problem);
  }
  return out;
}
