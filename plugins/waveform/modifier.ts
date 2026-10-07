/**
 * Built-in modifier: Waveform (port of the former Rust BaseOscillator).
 *
 * Output (bipolar): the host maps v = base + strength × (out − 1) / 2, so
 * out = 1 lands on the base value and out = −1 on base − strength.
 */
import { Modifier, Frame, Sample, Out, Params, register, fract, evaluateShape, clamp } from "@pixelmapper/plugin-sdk";

class Waveform extends Modifier {
  shape: i32 = 0;
  param: f32 = 0.5;
  start: f32 = 0;
  end: f32 = 1;
  offset: f32 = 0;
  useFloor: bool = false;
  floor: f32 = 0;

  /** Reads params in manifest order. */
  prepare(p: Params): void {
    this.shape = p.int(0);
    this.param = p.get(1);
    this.start = p.get(2);
    this.end = p.get(3);
    this.offset = p.get(4);
    this.useFloor = p.bool(5);
    this.floor = p.get(6);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const t = fract(s.phase);
    // No window: the whole cycle is active.
    if (this.start >= this.end) {
      out.set(0, evaluateShape(this.shape, t, this.param) + this.offset);
      return;
    }
    if (t < this.start || t > this.end) {
      if (this.useFloor) {
        // base × floor, expressed in the host's bipolar mapping.
        const st = Mathf.max(ctx.strength, 1e-6);
        out.set(0, clamp(1.0 - 2.0 * s.base0 * (1.0 - this.floor) / st, -2.0, 2.0));
      } else {
        out.set(0, this.offset);
      }
      return;
    }
    const local = (t - this.start) / (this.end - this.start);
    out.set(0, evaluateShape(this.shape, local, this.param) + this.offset);
  }
}

register(new Waveform());
