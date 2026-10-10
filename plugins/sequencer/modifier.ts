/**
 * Built-in modifier: Pattern (plan M8). A step grid (rows = groups, columns
 * = steps) switches groups of fixtures on and off, one step per cycle unit:
 *
 *   k = ⌊timePhase⌋ mod steps; f = fract(timePhase)
 *   group: host group if any, else from the order numbers —
 *          Alternate: rank mod rows, Blocks: ⌊rank·rows / rankCount⌋
 *          (without ranks: spatial quantized to 16 ranks)
 *   v = cell(k, g), crossfading to cell(k+1, g) in the last `transition`
 *
 * Output `scale`: on = programmed value, off = dimmed by strength.
 * Param slots: arrange 0, steps 1–18 (groups, steps, mask[16]),
 * transition 19, invert 20.
 */
import { Modifier, Frame, Sample, Out, Params, register, clamp } from "@pixelmapper/plugin-sdk";

class Pattern extends Modifier {
  blocks: bool = false;
  rows: i32 = 1;
  steps: i32 = 1;
  maskPtr: usize = 0;
  transition: f32 = 0;
  invert: bool = false;

  prepare(p: Params): void {
    this.blocks = p.int(0) == 1;
    this.rows = max(1, p.int(1));
    this.steps = max(1, p.int(2));
    this.maskPtr = p.lut(3);
    this.transition = clamp(p.get(19), 0.0, 1.0);
    this.invert = p.bool(20);
  }

  /** Cell of step `k`, group `g` (0 or 1). */
  cell(k: i32, g: i32): f32 {
    const mask = <i32>load<f32>(this.maskPtr + (<usize>k << 2));
    return (mask >> g) & 1 ? 1.0 : 0.0;
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    let rank = s.rank;
    let count = ctx.rankCount;
    if (rank < 0 || count <= 0) {
      count = 16;
      rank = min(15, <i32>Mathf.floor(clamp(s.spatial, 0.0, 1.0) * 16.0));
    }
    let g: i32;
    if (s.distGroup >= 0) g = s.distGroup % this.rows;
    else if (this.blocks) g = min(this.rows - 1, rank * this.rows / max(count, 1));
    else g = rank % this.rows;

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
