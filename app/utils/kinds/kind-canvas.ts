/**
 * Kind fixtures → 2D canvas payload (plan P5.2).
 *
 * The Rust canvas draws kind fixtures generically from world-pixel body
 * primitives, beam emitters and handles. This module transforms the
 * compiled (fixture-relative) geometry to world pixels and resolves style
 * colors (CSS colors and theme variables) to RGBA bytes.
 */
import type { BodyPrimitive, BodyStyle, Vec2 } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FIXTURE_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '~/utils/engine/constants';
import { kindToWorld, kindWorldAabb } from './kind-host';

/** RGBA bytes. */
type Rgba = [number, number, number, number];

const colorCache = new Map<string, Rgba | null>();
let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Resolves a CSS color (incl. `var(--token)`) to RGBA bytes; null when it
 * cannot be resolved (e.g. without a DOM).
 */
export function resolveCssColor(color: string | undefined, opacity = 1): Rgba | null {
  if (!color) return null;
  const key = `${color}|${opacity}`;
  if (colorCache.has(key)) return colorCache.get(key)!;
  let value = color.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  if (v && typeof document !== 'undefined') value = getComputedStyle(document.documentElement).getPropertyValue(v[1]!).trim();
  let out: Rgba | null = null;
  if (probe === undefined) probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (probe && value) {
    // The 2D context normalizes any CSS color; one pixel fill yields the bytes.
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000000';
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    out = [d[0]!, d[1]!, d[2]!, Math.round(d[3]! * opacity)];
  }
  colorCache.set(key, out);
  return out;
}

/** Clears cached colors (theme change). */
export function clearColorCache(): void {
  colorCache.clear();
}

/** Style → canvas style. */
function style(s: BodyStyle | undefined) {
  const opacity = s?.opacity ?? 1;
  return { stroke: resolveCssColor(s?.stroke, opacity), fill: resolveCssColor(s?.fill, opacity) };
}

/** One primitive in world pixels (rects become polygons under rotation). */
function primitiveToWorld(f: Fixture, p: BodyPrimitive): Record<string, unknown> | null {
  const w = (q: Vec2): [number, number] => {
    const r = kindToWorld(f, q);
    return [r.x, r.y];
  };
  switch (p.type) {
    case 'polyline':
      return { type: 'polyline', points: p.points.map(w), closed: !!p.closed, width: p.width, style: style(p.style) };
    case 'polygon':
      return { type: 'polygon', points: p.points.map(w), style: style(p.style) };
    case 'circle':
      return { type: 'circle', center: w(p.center), radius: p.radius, style: style(p.style) };
    case 'rect': {
      if ((f.rotation ?? 0) % 360 === 0) {
        const o = w({ x: p.rect.x, y: p.rect.y });
        return { type: 'rect', rect: [o[0], o[1], p.rect.w, p.rect.h], radius: p.radius ?? 0, style: style(p.style) };
      }
      const { x, y, w: rw, h: rh } = p.rect;
      return { type: 'polygon', points: [{ x, y }, { x: x + rw, y }, { x: x + rw, y: y + rh }, { x, y: y + rh }].map(w), style: style(p.style) };
    }
    case 'svg':
      // Kinds don't draw SVG bodies in 2D yet (custom SVG fixtures use the core SVG path).
      return null;
  }
}

/** Options of `kindCanvasFields`. */
export interface KindCanvasOptions {
  editMode: boolean;
  focusedHandle: string | null;
}

/**
 * Canvas fields that override the generic fixture payload for kind
 * fixtures: AABB-based placement (for culling, spatial index, labels),
 * world-pixel body + handles, and per-beam emitters.
 */
export function kindCanvasFields(f: Fixture, opts: KindCanvasOptions) {
  const compiled = f.kind?.compiled;
  if (!compiled) return null;
  const box = kindWorldAabb(f);
  const cx = box ? (box.minX + box.maxX) / 2 : f.fixturePosition.x * WORLD_WIDTH;
  const cy = box ? (box.minY + box.maxY) / 2 : f.fixturePosition.y * WORLD_HEIGHT;
  const emittersByBeam = new Map(f.beams.map((b) => {
    const pts = b.emitters ?? (b.offsetPx ? [b.offsetPx] : []);
    return [b.id, { emitters: pts.map((e) => { const r = kindToWorld(f, e); return [r.x, r.y]; }), emitterRadius: b.emitterRadius ?? 0 }];
  }));
  return {
    worldX: cx / WORLD_WIDTH,
    worldY: cy / WORLD_HEIGHT,
    width: box ? Math.max((box.maxX - box.minX) / 2, 8) / FIXTURE_RADIUS : f.fixtureSize.x,
    height: box ? Math.max((box.maxY - box.minY) / 2, 8) / FIXTURE_RADIUS : f.fixtureSize.y,
    rotation: 0,
    editMode: opts.editMode,
    focusedHandle: opts.focusedHandle,
    body: compiled.body.map(p => primitiveToWorld(f, p)).filter(Boolean),
    handles: compiled.handles.map((h) => {
      const r = kindToWorld(f, h.pos);
      return { id: h.id, x: r.x, y: r.y, role: h.role };
    }),
    emittersByBeam,
  };
}

/** True when a kind fixture can enter edit mode (has non-anchor handles). */
export function hasEditHandles(f: Fixture): boolean {
  return !!f.kind?.compiled?.handles.some(h => h.role !== 'anchor');
}
