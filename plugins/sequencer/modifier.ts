/**
 * Built-in modifier: Pattern (plan M8). A step grid (rows = groups, columns
 * = steps) switches groups of fixtures on and off, one step per cycle unit:
 *
 *   k = ⌊timePhase⌋ mod steps; f = fract(timePhase)
 *   group (row) from the spread (ABI v1.2 `ctx.spread`) —
 *          Fixture by fixture: number mod rows (1-2-1-2),
 *          Spatial 2D: bands along the handle, ⌊spatial·rows⌋ (1-1-2-2),
 *          Within each fixture: bands of heads, ⌊head·rows / heads⌋
 *   v = cell(k, g), crossfading to cell(k+1, g) in the last `transition`
 *
 * Output `scale`: on = programmed value, off = dimmed by strength.
 * Param slots: steps 0–17 (groups, steps, mask[16]), transition 18,
 * invert 19.
 */
import { Modifier, Frame, Sample, Out, Params, register, clamp, SPREAD_ORDER, SPREAD_WITHIN } from "@pixelmapper/plugin-sdk";

class Pattern extends Modifier {
  rows: i32 = 1;
  steps: i32 = 1;
  maskPtr: usize = 0;
  transition: f32 = 0;
  invert: bool = false;

  prepare(p: Params): void {
    this.rows = max(1, p.int(0));
    this.steps = max(1, p.int(1));
    this.maskPtr = p.lut(2);
    this.transition = clamp(p.get(18), 0.0, 1.0);
    this.invert = p.bool(19);
  }

  /** Cell of step `k`, group `g` (0 or 1). */
  cell(k: i32, g: i32): f32 {
    const mask = <i32>load<f32>(this.maskPtr + (<usize>k << 2));
    return (mask >> g) & 1 ? 1.0 : 0.0;
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const rows = this.rows;
    let g: i32;
    if (s.distGroup >= 0) g = s.distGroup % rows;
    else if (ctx.spread == SPREAD_ORDER && s.rank >= 0) g = s.rank % rows;
    else if (ctx.spread == SPREAD_WITHIN) g = min(rows - 1, s.headIndex * rows / max(s.headCount, 1));
    else g = min(rows - 1, <i32>Mathf.floor(clamp(s.spatial, 0.0, 1.0) * <f32>rows));

    const tp = ctx.timePhase;
    const fk = Mathf.floor(tp);
    const f = tp - fk;
    const k = ((<i32>fk % this.steps) + this.steps) % this.steps;
    const on = this.cell(k, g);
    let v = on;
    const w = this.transition;
    if (w > 0.0 && f > 1.0 - w) {
      const t = (f - (1.0 - w)) / w;
      const next = this.cell((k + 1) % this.steps, g);
      v = on + (next - on) * (t * t * (3.0 - 2.0 * t));
    }
    out.set(0, this.invert ? 1.0 - v : v);
  }
}

register(new Pattern());
