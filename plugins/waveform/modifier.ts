/**
 * Built-in modifier: Wave (plan M6). A profile (what is lit over the
 * distance) moves along the distribution according to a motion curve
 * (where the profile is during one pass):
 *
 *   m = motion(fract(timePhase)); x = spatial − m; v = profile(x)
 *
 * Output `scale`: v is a fraction of the programmed value (1 = programmed).
 * Params (slots): profile LUT (signed, 0–127), motion LUT (cycle, 128–255),
 * invert (256).
 */
import { Modifier, Frame, Sample, Out, Params, register, fract, sampleLut, sampleSignedLut, clamp } from "@pixelmapper/plugin-sdk";

class Wave extends Modifier {
  profile: usize = 0;
  motion: usize = 0;
  invert: bool = false;

  /** Reads params in manifest order. */
  prepare(p: Params): void {
    this.profile = p.lut(0);
    this.motion = p.lut(128);
    this.invert = p.bool(256);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const m = sampleLut(this.motion, fract(ctx.timePhase));
    const v = clamp(sampleSignedLut(this.profile, s.spatial - m), 0.0, 1.0);
    out.set(0, this.invert ? 1.0 - v : v);
  }
}

register(new Wave());
