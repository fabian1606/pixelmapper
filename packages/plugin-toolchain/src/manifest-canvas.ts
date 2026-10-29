/**
 * Validation of a param's `ui` field (plan M4 "Canvas hints").
 *
 * `ui` is either a `pm.*` input name (string) or the object form
 * `{ input?, canvas?, anchor?, label?, color? }`:
 * - `canvas: 'point'` on a `point` param → one draggable dot;
 * - `canvas: 'radius'` on a `number` param with `anchor` naming a `point`
 *   param → a draggable ring; the value is the radius in normalized world-x
 *   units (so `min` must be ≥ 0).
 */
import type { ParamDef, ParamSchema } from '@pixelmapper/extension-api';

/** Canvas handle kinds the host renders. */
export const CANVAS_KINDS = ['point', 'radius'] as const;
/** Keys the object form of `ui` may carry. */
const UI_OBJECT_KEYS = ['input', 'canvas', 'anchor', 'label', 'color'];
/** Max length of a handle label (it sits next to a small dot). */
const MAX_LABEL = 24;
/** Accepted CSS colors: hex, functional notations and named colors. */
const COLOR_RE = /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab)\([^)]*\)|[a-z]+)$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates `p.ui` of one param in isolation (input name, object shape,
 * canvas kind vs. param type). Anchor references are checked by
 * `validateCanvasRefs`, which needs the whole schema.
 */
export function validateParamUi(p: ParamDef, where: string, inputs: readonly string[], errors: string[]): void {
  const ui: unknown = p.ui;
  if (ui === undefined) return;
  if (typeof ui === 'string') {
    if (!inputs.includes(ui)) errors.push(`${where}: unknown ui "${ui}"`);
    return;
  }
  if (!isObj(ui)) {
    errors.push(`${where}: ui must be a pm.* input name or an object`);
    return;
  }
  for (const k of Object.keys(ui)) if (!UI_OBJECT_KEYS.includes(k)) errors.push(`${where}: ui has unknown field "${k}"`);
  if (ui.input !== undefined && (typeof ui.input !== 'string' || !inputs.includes(ui.input))) errors.push(`${where}: unknown ui.input "${String(ui.input)}"`);

  if (ui.canvas === undefined) {
    if (ui.anchor !== undefined || ui.label !== undefined || ui.color !== undefined) errors.push(`${where}: ui.anchor/label/color need ui.canvas`);
    return;
  }
  if (!(CANVAS_KINDS as readonly unknown[]).includes(ui.canvas)) {
    errors.push(`${where}: unknown ui.canvas "${String(ui.canvas)}" (use ${CANVAS_KINDS.join(' or ')})`);
    return;
  }
  if (ui.label !== undefined && (typeof ui.label !== 'string' || !ui.label.trim() || ui.label.length > MAX_LABEL)) errors.push(`${where}: ui.label must be a non-empty string of at most ${MAX_LABEL} characters`);
  if (ui.color !== undefined && (typeof ui.color !== 'string' || !COLOR_RE.test(ui.color))) errors.push(`${where}: ui.color must be a CSS color like "#ff8800"`);

  if (ui.canvas === 'point') {
    if (p.type !== 'point') errors.push(`${where}: ui.canvas "point" needs a point param`);
    if (ui.anchor !== undefined) errors.push(`${where}: ui.anchor only applies to ui.canvas "radius"`);
  } else {
    if (p.type !== 'number') errors.push(`${where}: ui.canvas "radius" needs a number param`);
    else if (typeof p.min === 'number' && p.min < 0) errors.push(`${where}: ui.canvas "radius" needs min ≥ 0 (the value is a radius)`);
    if (typeof ui.anchor !== 'string' || !ui.anchor) errors.push(`${where}: ui.canvas "radius" needs ui.anchor (a point param key)`);
  }
}

/**
 * Cross-param checks: a radius anchor must name an existing `point` param.
 * An anchor without its own point handle only warns (the ring then sits
 * still; its center is edited in the card).
 */
export function validateCanvasRefs(params: ParamSchema, errors: string[], warnings: string[]): void {
  const byKey = new Map(params.map(p => [p.key, p]));
  params.forEach((p, i) => {
    const ui: unknown = p.ui;
    if (!isObj(ui) || ui.canvas !== 'radius' || typeof ui.anchor !== 'string' || !ui.anchor) return;
    const where = `params[${i}] "${p.key}"`;
    const anchor = byKey.get(ui.anchor);
    if (!anchor) errors.push(`${where}: ui.anchor refers to unknown param "${ui.anchor}"`);
    else if (anchor.type !== 'point') errors.push(`${where}: ui.anchor "${ui.anchor}" must be a point param`);
    else if (!isObj(anchor.ui) || anchor.ui.canvas !== 'point') warnings.push(`${where}: anchor "${ui.anchor}" has no ui.canvas "point"; the ring center is not draggable`);
  });
}
