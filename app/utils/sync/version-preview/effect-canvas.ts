import { PREVIEW_SHAPE } from '~/utils/sync/remote-api-snapshot-preview';
import type { EffectTarget } from './effect-preview';
import type { PlacedFixture, PreviewCamera, PreviewModel } from './preview-model';

/**
 * 2D-canvas drawing of the effect hover preview: all fixtures dimmed in
 * their base colors, the effect's targets on top, either colored by the
 * rendered frame (one color per point: per fixture, per dot for bars) or —
 * when the plugin cannot render (unknown, broken, still loading) — in their
 * base colors with a highlight ring. No WebGL: ≤400 fixtures take ~1 ms.
 */

/** Alpha of fixtures the effect does not touch. */
const DIM_ALPHA = 0.22;
/** Ring around targeted fixtures. */
const TARGET_RING = 'rgba(255,255,255,0.85)';
/** Body of animated pixel bars (dots carry the color). */
const BAR_BODY = 'rgba(24,24,27,0.9)';
/** Group outline stroke. */
const OUTLINE = 'rgba(255,255,255,0.12)';

/** Everything that stays the same between frames. */
export interface EffectScene {
  model: PreviewModel;
  camera: PreviewCamera;
  targets: readonly EffectTarget[];
  /** Indices into `model.fixtures` that are targeted. */
  targetSet: ReadonlySet<number>;
  /** CSS px viewport and device pixel ratio. */
  width: number;
  height: number;
  dpr: number;
}

/** CSS color of point `i` in `colors` (RGB bytes). */
function rgbAt(colors: Uint8ClampedArray, i: number): string {
  const o = i * 3;
  return `rgb(${colors[o]},${colors[o + 1]},${colors[o + 2]})`;
}

/** Path of a fixture body in its local (rotated) frame. */
function bodyPath(ctx: CanvasRenderingContext2D, f: PlacedFixture, radius: number): void {
  ctx.beginPath();
  if (f.shape === PREVIEW_SHAPE.single) ctx.ellipse(0, 0, f.hw, f.hh, 0, 0, Math.PI * 2);
  else if (typeof ctx.roundRect === 'function') ctx.roundRect(-f.hw, -f.hh, f.hw * 2, f.hh * 2, radius);
  else ctx.rect(-f.hw, -f.hh, f.hw * 2, f.hh * 2);
}

/** Pixel dots of a bar, each in `fill(dotIndex)`. */
function drawDots(ctx: CanvasRenderingContext2D, f: PlacedFixture, fill: (i: number) => string): void {
  for (let i = 0; i < f.dots.length; i++) {
    const d = f.dots[i]!;
    ctx.fillStyle = fill(i);
    ctx.beginPath();
    ctx.arc(d.x, d.y, f.dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Fixture in its base color (dimmed background or static highlight). */
function drawBase(ctx: CanvasRenderingContext2D, f: PlacedFixture, unit: number): void {
  bodyPath(ctx, f, 4 * unit);
  if (f.shape === PREVIEW_SHAPE.multi) {
    ctx.fillStyle = BAR_BODY;
    ctx.fill();
    drawDots(ctx, f, () => f.color);
  }
  else {
    ctx.fillStyle = f.color;
    ctx.fill();
  }
}

/**
 * Draws one frame. `colors` holds RGB bytes per point of `scene.targets`
 * (null = static highlight in base colors).
 */
export function drawEffectFrame(ctx: CanvasRenderingContext2D, scene: EffectScene, colors: Uint8ClampedArray | null): void {
  const { model, camera, dpr } = scene;
  const unit = 1 / camera.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, scene.width * dpr, scene.height * dpr);
  ctx.setTransform(camera.scale * dpr, 0, 0, camera.scale * dpr, camera.x * dpr, camera.y * dpr);

  // Group outlines.
  ctx.globalAlpha = 1;
  ctx.lineWidth = unit;
  ctx.strokeStyle = OUTLINE;
  for (const g of model.groups) ctx.strokeRect(g.box.minX, g.box.minY, g.box.maxX - g.box.minX, g.box.maxY - g.box.minY);

  // Untouched fixtures, dimmed.
  ctx.globalAlpha = DIM_ALPHA;
  for (let i = 0; i < model.fixtures.length; i++) {
    if (scene.targetSet.has(i)) continue;
    const f = model.fixtures[i]!;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    if (f.rotation) ctx.rotate((f.rotation * Math.PI) / 180);
    drawBase(ctx, f, unit);
    ctx.restore();
  }

  // Targets: effect colors (or base colors) plus the ring.
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = TARGET_RING;
  for (const t of scene.targets) {
    const f = model.fixtures[t.fixture]!;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    if (f.rotation) ctx.rotate((f.rotation * Math.PI) / 180);
    if (!colors) drawBase(ctx, f, unit);
    else if (f.shape === PREVIEW_SHAPE.multi && t.count > 1) {
      bodyPath(ctx, f, 4 * unit);
      ctx.fillStyle = BAR_BODY;
      ctx.fill();
      drawDots(ctx, f, i => rgbAt(colors, t.start + Math.min(i, t.count - 1)));
    }
    else {
      bodyPath(ctx, f, 4 * unit);
      ctx.fillStyle = rgbAt(colors, t.start);
      ctx.fill();
    }
    bodyPath(ctx, f, 4 * unit);
    ctx.stroke();
    ctx.restore();
  }
}
