/**
 * Canvas hints (plan M4 "Canvas hints"): a param declares that it gets a
 * draggable handle on the 2D canvas, so plugin authors (and the AI) get
 * spatial controls without writing UI code.
 *
 * A hint lives in the param's `ui` field in object form:
 *
 * ```json
 * { "key": "center", "type": "point", "default": { "x": 0.5, "y": 0.5 }, "label": "Center",
 *   "ui": { "canvas": "point", "label": "C", "color": "#ff8800" } }
 * { "key": "size", "type": "number", "min": 0.01, "max": 1, "default": 0.2, "label": "Size",
 *   "ui": { "canvas": "radius", "anchor": "center" } }
 * ```
 *
 * The string form of `ui` (`"pm.fader"`) still names the card input; the
 * object form carries that as `input`. The card input stays available
 * either way, so a hinted param is editable on the canvas and in the card.
 *
 * Coordinates: points are `{ x, y }` in normalized world space (x across the
 * world width, y across the world height, each 0–1). A radius is measured in
 * **normalized world-x units** (1 = the world width): the ring is a true
 * circle on the canvas. The world is square, so world x/y are isotropic and
 * a plugin compares the radius against `dist2(s.x, s.y, px, py, 1.0)`
 * (`ctx.worldAspect` is only needed for room coordinates `Sample.u/v`).
 */
import type { PmInputName } from './replaceables';

/** Kinds of canvas handles a param can declare. */
export type CanvasHintKind = 'point' | 'radius';

/** Fields every canvas hint may carry. */
interface CanvasHintBase {
  /** Short text next to the handle (default: the param label). */
  label?: string;
  /** CSS color of the handle, e.g. `#ff8800` (default: the theme primary). */
  color?: string;
}

/** On a `point` param: one draggable dot at the param's value. */
export interface CanvasPointHint extends CanvasHintBase {
  canvas: 'point';
}

/**
 * On a `number` param: a draggable ring around the `anchor` point param. The
 * value is the radius in normalized world-x units, clamped to the param's
 * `[min, max]`.
 */
export interface CanvasRadiusHint extends CanvasHintBase {
  canvas: 'radius';
  /** Key of the `point` param the ring is centered on. */
  anchor: string;
}

/** Any canvas hint. */
export type CanvasHint = CanvasPointHint | CanvasRadiusHint;

/**
 * Object form of a param's `ui`: card input override plus an optional canvas
 * hint. The hint fields are flat (`canvas`, `anchor`, `label`, `color`);
 * `validateManifest` checks which combination is valid for the param type.
 */
export interface ParamUiOptions {
  /** Card input override (default: the type's `pm.*` input). */
  input?: PmInputName;
  /** Canvas handle kind. */
  canvas?: CanvasHintKind;
  /** `radius` only: key of the anchor `point` param. */
  anchor?: string;
  /** Short text next to the handle. */
  label?: string;
  /** CSS color of the handle. */
  color?: string;
}

/** A param's `ui`: a `pm.*` input name, or the object form with a canvas hint. */
export type ParamUi = PmInputName | ParamUiOptions;

/** The explicit card input of a param `ui` (undefined = the type's default). */
export function paramUiInput(ui: ParamUi | undefined): PmInputName | undefined {
  if (!ui) return undefined;
  return typeof ui === 'string' ? ui : ui.input;
}

/** The canvas hint of a param `ui`, or null when it declares none. */
export function paramCanvasHint(ui: ParamUi | undefined): CanvasHint | null {
  if (!ui || typeof ui !== 'object' || !ui.canvas) return null;
  return ui as CanvasHint;
}
