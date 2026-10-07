/**
 * Built-in modifier: Sequencer (port of the former Rust SequencerEffect).
 *
 * Output (bipolar): on → 1 (base), off → 1 − 2·base, which the host maps to
 * base × (1 − strength) — the former darkening behavior.
 */
import { Modifier, Frame, Sample, Out, Params, register, seededRandom, perlin2, fract, clamp, roundAway } from "@pixelmapper/plugin-sdk";

const SPLIT: i32 = 0;
const CHECKERBOARD: i32 = 1;
const SECTIONS: i32 = 2;
const SCATTER: i32 = 3;

class Sequencer extends Modifier {
  pattern: i32 = 0;
  ox: f32 = 0.5;
  oy: f32 = 0.5;
  sin: f32 = 0;
  cos: f32 = 1;
  scale: f32 = 0.1;
  density: f32 = 0.5;
  variation: f32 = 0;
  invert: bool = false;

  prepare(p: Params): void {
    this.pattern = p.int(0);
    this.ox = p.get(1);
    this.oy = p.get(2);
    const angle = p.get(3);
    this.sin = Mathf.sin(angle);
    this.cos = Mathf.cos(angle);
    this.scale = p.get(4);
    this.density = p.get(5);
    this.variation = p.get(6);
    this.invert = p.bool(7);
  }

  /** Writes on/off as a bipolar value. */
  emit(on: bool, s: Sample, out: Out): void {
    out.set(0, on ? 1.0 : 1.0 - 2.0 * s.base0);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    // Frozen speed: the cycle counter stays at 0 (as before).
    const cycle: u32 = ctx.phaseSpeed > 0.0 ? <u32>Mathf.floor(ctx.timeMs * ctx.phaseSpeed / 1000.0) : 0;

    if (this.pattern == SCATTER) {
      let density = this.density;
      if (this.variation > 0.0) {
        const v = seededRandom(cycle * 1664525 + 1013904223) * 2.0 - 1.0;
        density = clamp(this.density + v * this.variation, 0.0, 1.0);
      }
      const cycleSeed = cycle * 2654435761;
      const n = max(s.groupCount, 1);
      const target = <i32>roundAway(density * <f32>n);
      const mine = seededRandom(<u32>s.groupIndex + cycleSeed);
      let rank = 0;
      for (let i = 0; i < s.groupCount; i++) {
        if (seededRandom(<u32>i + cycleSeed) < mine) rank++;
      }
      this.emit((rank < target) != this.invert, s, out);
      return;
    }
    if (this.pattern > SCATTER) {
      // Flow: moving Perlin boundary.
      const t: f32 = ctx.phaseSpeed > 0.0 ? ctx.timeMs / 1000.0 * ctx.phaseSpeed : 0.0;
      const cell = Mathf.max(this.scale, 0.01);
      const noise = perlin2(s.x / cell + t, s.y / cell + t * 0.7);
      this.emit((noise > this.density * 2.0 - 1.0) != this.invert, s, out);
      return;
    }

    const dx = s.x - this.ox;
    const dy = s.y - this.oy;
    const u = dx * this.cos + dy * this.sin;
    const v = -dx * this.sin + dy * this.cos;
    const cell = this.scale;
    let on: bool;
    if (this.pattern == SPLIT) {
      on = v > 0.0;
    } else if (this.pattern == CHECKERBOARD) {
      const gu = cell > 0.0 ? <i32>Mathf.floor(u / cell) : 0;
      const gv = cell > 0.0 ? <i32>Mathf.floor(v / cell) : 0;
      on = ((gu + gv) % 2 + 2) % 2 == 0;
    } else {
      on = cell > 0.0 ? <i32>Mathf.abs(Mathf.floor(u / cell)) % 2 == 0 : true;
    }
    // Flip every half cycle.
    if (fract(s.phase) >= 0.5) on = !on;
    this.emit(on != this.invert, s, out);
  }
}

register(new Sequencer());
