import { PREVIEW_SHAPE } from '~/utils/sync/remote-api-snapshot-preview';
import { PREVIEW_WORLD, type PlacedFixture, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * Maps a `PreviewModel` to the fixture payload of `rs-engine-canvas`
 * (`FixtureCanvasData` in `rs-engine/canvas/src/types.rs`, the same JSON
 * `FixtureCanvas.vue` sends) plus a synthetic DMX buffer, so the workspace
 * renderer draws a static frame of the snapshot. Colors: one COLOR channel
 * per distinct base color at full level (`resolve_color` adds
 * `rgb × dmx/255`), so every fixture shows its base color.
 */

/** One color channel reference (`ColorChannel`). */
interface ColorRef {
  index: number;
  r: number;
  g: number;
  b: number;
}

export interface CanvasPayload {
  /** `FixtureCanvasData[]` (JSON-ready). */
  fixtures: Array<Record<string, unknown>>;
  /** DMX values: 255 at every color channel index. */
  dmx: Uint8Array;
}

/** Fill alpha of kind bodies (outline drawn at full opacity). */
const KIND_FILL_ALPHA = 90;

/** Builds the canvas payload of `model`. */
export function toCanvasPayload(model: PreviewModel): CanvasPayload {
  const palette = new Map<string, ColorRef>();
  /** Channel of `hex` (allocated on first use). */
  const channel = (hex: string): ColorRef => {
    let ref = palette.get(hex);
    if (!ref) {
      const [r, g, b] = hexToRgb(hex);
      ref = { index: palette.size, r, g, b };
      palette.set(hex, ref);
    }
    return ref;
  };

  const fixtures = model.fixtures.map((f, i) => toCanvasFixture(f, i, channel(f.color)));
  const dmx = new Uint8Array(Math.max(palette.size, 1));
  for (const ref of palette.values()) dmx[ref.index] = 255;
  return { fixtures, dmx };
}

/** One `FixtureCanvasData` (geometry in the units FixtureCanvas.vue uses). */
function toCanvasFixture(f: PlacedFixture, i: number, color: ColorRef): Record<string, unknown> {
  const base = {
    id: `p${i}`,
    name: '',
    worldX: f.cx / PREVIEW_WORLD,
    worldY: f.cy / PREVIEW_WORLD,
    svg: null,
    channelStart: 0,
  };
  if (f.shape === PREVIEW_SHAPE.single) {
    // Single head: fixture-level color, radii 16 × size.
    return { ...base, width: f.hw / 16, height: f.hh / 16, rotation: f.rotation, colorChannels: [color], beams: [] };
  }
  if (f.shape === PREVIEW_SHAPE.multi) {
    // Pixel bar: beams at local −0.5…0.5, half extents 18 × size.
    return {
      ...base,
      width: f.hw / 18,
      height: f.hh / 18,
      rotation: f.rotation,
      beams: f.dots.map((d, j) => ({
        id: `b${j}`,
        localX: d.x / (f.hw * 2),
        localY: d.y / (f.hh * 2),
        colorChannels: [color],
      })),
    };
  }
  // Kind: body polygon in world px (rotation baked in, like kindCanvasFields).
  return {
    ...base,
    width: f.hw / 18,
    height: f.hh / 18,
    rotation: 0,
    beams: [],
    body: [{
      type: 'polygon',
      points: rotatedCorners(f),
      style: { fill: [color.r, color.g, color.b, KIND_FILL_ALPHA], stroke: [color.r, color.g, color.b, 255] },
    }],
  };
}

/** Corners of the fixture rectangle rotated around its center (world px). */
export function rotatedCorners(f: PlacedFixture): Array<[number, number]> {
  const rad = (f.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
    const lx = sx * f.hw;
    const ly = sy * f.hh;
    return [f.cx + lx * cos - ly * sin, f.cy + lx * sin + ly * cos];
  });
}

/** `#rrggbb` → [r, g, b] (invalid → white). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  return [Number.parseInt(m[1]!, 16), Number.parseInt(m[2]!, 16), Number.parseInt(m[3]!, 16)];
}
