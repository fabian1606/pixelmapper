/**
 * Built-in modifier: Corner Wave (effect-authoring reference, plan M5).
 * Wave fronts radiate from up to four draggable points (`point` params with
 * `ui.canvas: "point"`), the reach is a ring on the canvas (`ui.canvas:
 * "radius"`):
 *
 *   d   = distance to the nearest point (world x/y, isotropic)
 *   pos = d / spacing ∓ timePhase        (− outward, + inward)
 *   v   = pulse(fract(pos), 0.5, width, softness) × fade(d / reach)
 *   rgb = palette(front index / 4) × v
 *
 * Points and the reach live in world coordinates, the same space as
 * `Sample.x/y`, so distances use `dist2(…, aspect = 1)`.
 * Output `absolute` rgb: dark between the fronts.
 * Params (slots): colors 0–32 (gradient), spacing 33, width 34, softness 35,
 * direction 36 (0 out, 1 in), reach 37, sources 38, a 39–40, b 41–42,
 * c 43–44, d 45–46.
 */
import {
  Modifier, Frame, Sample, Out, Params, register,
  fract, clamp, smoothstep, pulse, minDistToPoints, sampleGradient,
} from "@pixelmapper/plugin-sdk";

/** Slot of the first point (A); B–D follow in pairs. */
const POINTS_SLOT: i32 = 39;
/** Palette step between two neighbouring fronts. */
const COLOR_STEP: f32 = 0.25;
/** Inner part of the reach at full level; the outer 30 % fades out. */
const FADE_START: f32 = 0.7;

class CornerWave extends Modifier {
  colors: usize = 0;
  spacing: f32 = 0.25;
  width: f32 = 0.4;
  softness: f32 = 0.7;
  inward: bool = false;
  reach: f32 = 0.7;
  sources: i32 = 4;
  /** Interleaved point coordinates [ax, ay, bx, by, …]; allocated once. */
  pts: StaticArray<f32> = new StaticArray<f32>(8);

  /** Reads params in manifest order (called on param changes, not per frame). */
  prepare(p: Params): void {
    this.colors = p.lut(0);
    this.spacing = Mathf.max(p.get(33), 0.01);
    this.width = p.get(34);
    this.softness = p.get(35);
    this.inward = p.int(36) == 1;
    this.reach = Mathf.max(p.get(37), 0.01);
    this.sources = p.int(38);
    for (let i = 0; i < 8; i++) this.pts[i] = p.get(POINTS_SLOT + i);
  }

  /** Pure: color of one head from its distance to the nearest point and the time phase. */
  render(ctx: Frame, s: Sample, out: Out): void {
    const d = minDistToPoints(s.x, s.y, 1.0, this.pts, this.sources);
    const w = d / this.spacing;
    const pos = this.inward ? w + ctx.timePhase : w - ctx.timePhase;
    // One lit band per front, centered between two integer positions.
    let v = pulse(fract(pos), 0.5, this.width, this.softness);
    // Fade out towards the reach.
    const edge = clamp((d - this.reach * FADE_START) / (this.reach * (1.0 - FADE_START)), 0.0, 1.0);
    v *= 1.0 - smoothstep(edge);
    // Every front keeps its own palette color while it travels.
    const u = fract(Mathf.floor(pos) * COLOR_STEP);
    out.setRgb(
      sampleGradient(this.colors, u, 1.0, 0) * v,
      sampleGradient(this.colors, u, 1.0, 1) * v,
      sampleGradient(this.colors, u, 1.0, 2) * v,
    );
  }
}

register(new CornerWave());
