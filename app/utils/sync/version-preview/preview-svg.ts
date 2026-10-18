import { PREVIEW_SHAPE } from '~/utils/sync/remote-api-snapshot-preview';
import { fitCamera, type PreviewCamera, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * SVG fallback of the hover preview (used when the WASM canvas renderer is
 * unavailable, e.g. no WebGL): maps a `PreviewModel` to plain shape
 * descriptors that `VersionPreviewSchematic.vue` renders. World coordinates
 * inside one `<g transform>`; stroke widths are divided by the scale so they
 * stay ~1–2 screen px like on the workspace canvas.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SvgShape =
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; transform: string }
  | { type: 'bar'; x: number; y: number; width: number; height: number; radius: number; transform: string; dots: Array<{ cx: number; cy: number; r: number; fill: string }> }
  | { type: 'kind'; x: number; y: number; width: number; height: number; radius: number; fill: string; transform: string };

export interface SvgOutline {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export interface SvgScene {
  width: number;
  height: number;
  /** `matrix(...)` world → viewport. */
  transform: string;
  camera: PreviewCamera;
  shapes: SvgShape[];
  outlines: SvgOutline[];
  /** Ring stroke width in world units (2 screen px). */
  stroke: number;
  /** Group outline stroke width in world units (1 screen px). */
  outlineStroke: number;
}

/** Unselected fixture ring (render.rs `border_color`: white @ 0.22). */
export const RING_COLOR = 'rgba(255,255,255,0.22)';

// ── Mapping ──────────────────────────────────────────────────────────────────

/** Builds the SVG scene of `model` for a `width × height` viewport. */
export function toSvgScene(model: PreviewModel, width: number, height: number): SvgScene {
  const camera = fitCamera(model.bounds, width, height);
  const unit = 1 / camera.scale;
  const shapes: SvgShape[] = model.fixtures.map((f) => {
    const transform = f.rotation ? `rotate(${round(f.rotation)} ${round(f.cx)} ${round(f.cy)})` : '';
    if (f.shape === PREVIEW_SHAPE.single) {
      return { type: 'ellipse', cx: round(f.cx), cy: round(f.cy), rx: round(f.hw), ry: round(f.hh), fill: f.color, transform };
    }
    const rect = { x: round(f.cx - f.hw), y: round(f.cy - f.hh), width: round(f.hw * 2), height: round(f.hh * 2), radius: round(4 * unit), transform };
    if (f.shape === PREVIEW_SHAPE.kind) return { type: 'kind', ...rect, fill: f.color };
    return {
      type: 'bar',
      ...rect,
      dots: f.dots.map(d => ({ cx: round(f.cx + d.x), cy: round(f.cy + d.y), r: round(f.dotRadius), fill: f.color })),
    };
  });
  const outlines: SvgOutline[] = model.groups.map(g => ({
    x: round(g.box.minX),
    y: round(g.box.minY),
    width: round(g.box.maxX - g.box.minX),
    height: round(g.box.maxY - g.box.minY),
    name: g.name,
  }));
  return {
    width,
    height,
    transform: `matrix(${round(camera.scale, 5)} 0 0 ${round(camera.scale, 5)} ${round(camera.x)} ${round(camera.y)})`,
    camera,
    shapes,
    outlines,
    stroke: round(2 * unit, 4),
    outlineStroke: round(unit, 4),
  };
}

/** Rounds for compact attributes. */
function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
