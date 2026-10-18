import type { Preset } from '~/utils/engine/preset-types';
import type { FixtureHighlight } from '~/utils/sync/version-preview/highlight-types';
import { fitCamera, fixtureBox, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * Highlight mapping of the hover preview (pure): changed fixtures → screen
 * rings over the layout renderer, and a preset's colours → a recoloured
 * layout model. Both renderers (WebGL and SVG) use `fitCamera` with the same
 * arguments, so the overlay lines up with either.
 */

// ── Fixture marks ────────────────────────────────────────────────────────────

export type FixtureMark = 'added' | 'moved' | 'changed';

/** Ring colours per mark (emerald / sky / amber). */
export const MARK_COLORS: Record<FixtureMark, string> = {
  added: '#34d399',
  moved: '#38bdf8',
  changed: '#fbbf24',
};

/** Layout index → mark; `added` wins over `moved` wins over `changed`. */
export function fixtureMarks(h: FixtureHighlight): Map<number, FixtureMark> {
  const marks = new Map<number, FixtureMark>();
  for (const i of h.changed) marks.set(i, 'changed');
  for (const i of h.moved) marks.set(i, 'moved');
  for (const i of h.added) marks.set(i, 'added');
  return marks;
}

/** One ring in viewport px. */
export interface HighlightRing {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  mark: FixtureMark;
}

/** Minimum ring size in px (tiny fixtures stay visible). */
const MIN_RING = 10;
/** Gap between fixture and ring in px. */
const RING_PAD = 3;

/** Screen rings around the marked fixtures of `model` in a `width × height` viewport. */
export function highlightRings(model: PreviewModel, marks: Map<number, FixtureMark>, width: number, height: number): HighlightRing[] {
  const cam = fitCamera(model.bounds, width, height);
  const rings: HighlightRing[] = [];
  for (const [index, mark] of marks) {
    const f = model.fixtures[index];
    if (!f) continue;
    const b = fixtureBox(f);
    const cx = ((b.minX + b.maxX) / 2) * cam.scale + cam.x;
    const cy = ((b.minY + b.maxY) / 2) * cam.scale + cam.y;
    const w = Math.max((b.maxX - b.minX) * cam.scale + RING_PAD * 2, MIN_RING);
    const h = Math.max((b.maxY - b.minY) * cam.scale + RING_PAD * 2, MIN_RING);
    rings.push({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, color: MARK_COLORS[mark], mark });
  }
  return rings;
}

// ── Preset colours ───────────────────────────────────────────────────────────

/** Colour of fixtures a preset does not touch. */
export const UNTOUCHED_COLOR = '#3f3f46';
/** Colour of fixtures programmed without colour information (dimmer only → by level). */
const PROGRAMMED_COLOR = '#e4e4e7';

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** First step value of the category's channels of `type` (max over fixtures), or null. */
function level(channels: Array<{ channelType?: unknown; stepValues?: unknown }>, type: string): number | null {
  let out: number | null = null;
  for (const ch of channels) {
    if (ch.channelType !== type || !Array.isArray(ch.stepValues)) continue;
    const v = Number(ch.stepValues[0]);
    if (Number.isFinite(v)) out = Math.max(out ?? 0, v);
  }
  return out;
}

/** Display colour of one preset category: RGB(+W), scaled by DIMMER; null when it carries no light values. */
export function categoryColor(channels: unknown): string | null {
  const list = Array.isArray(channels) ? channels as Array<{ channelType?: unknown; stepValues?: unknown }> : [];
  const r = level(list, 'RED');
  const g = level(list, 'GREEN');
  const b = level(list, 'BLUE');
  const w = level(list, 'WHITE') ?? 0;
  const dim = level(list, 'DIMMER');
  const scale = dim === null ? 1 : dim / 255;
  if (r !== null || g !== null || b !== null || w > 0) {
    return `#${hex2(((r ?? 0) + w) * scale)}${hex2(((g ?? 0) + w) * scale)}${hex2(((b ?? 0) + w) * scale)}`;
  }
  if (dim !== null) return `#${hex2(228 * scale)}${hex2(228 * scale)}${hex2(231 * scale)}`;
  return null;
}

/**
 * Layout index → colour of every fixture the preset programs. Colour
 * categories set the colour; a later category without light values keeps an
 * earlier colour (movement / beam / effect entries only mark the fixture).
 */
export function presetFixtureColors(preset: Preset, fixtureIndex: Record<string, number>): Map<number, string> {
  const colors = new Map<number, string>();
  for (const cat of Array.isArray(preset.categories) ? preset.categories : []) {
    if (!cat || !Array.isArray(cat.fixtureIds)) continue;
    const color = categoryColor(cat.channels);
    for (const id of cat.fixtureIds) {
      const index = fixtureIndex[String(id)];
      if (index === undefined) continue;
      if (color) colors.set(index, color);
      else if (!colors.has(index)) colors.set(index, PROGRAMMED_COLOR);
    }
  }
  return colors;
}

/** Copy of `model` with fixture colours replaced (`others` for fixtures not in `colors`). */
export function recolorModel(model: PreviewModel, colors: Map<number, string>, others = UNTOUCHED_COLOR): PreviewModel {
  return { ...model, fixtures: model.fixtures.map((f, i) => ({ ...f, color: colors.get(i) ?? others })) };
}
