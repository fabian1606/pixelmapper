/**
 * Built-in modifier: Color Shift (plan M7). Absolute RGB output; the host
 * mixes it in by strength. With m = motion(fract(timePhase)):
 *
 * - palette: the color of the palette at u = fract(spatial − m) (Arrange
 *   *Gradient*), or of stop (rank + ⌊m·stops⌋) mod stops (Arrange
 *   *Alternate*: neighbours in the order differ). The programmed brightness
 *   (max of the base RGB) is kept; unlit bases take the palette as is.
 * - shift: p = profile(spatial − m); hue = base hue + hueShift +
 *   hueRange·(2p − 1); saturation = base · saturation; the white dip
 *   blends toward white (at the programmed brightness) by satDip·p.
 *
 * Param slots: mode 0, palette 1–33, arrange 34, transition 35, hueShift 36,
 * hueRange 37, saturation 38, satDip 39, profile 40–167, motion 168–295.
 */
import {
  Modifier, Frame, Sample, Out, Params, register, Vec3, rgbToHsl, hslToRgb, fract, clamp,
  sampleLut, sampleSignedLut, sampleGradient, gradientCount, gradientStopChannel,
} from "@pixelmapper/plugin-sdk";

const HSL = new Vec3();
const RGB = new Vec3();

class ColorShift extends Modifier {
  palette: bool = false;
  alternate: bool = false;
  transition: f32 = 0;
  hueShift: f32 = 0;
  hueRange: f32 = 0;
  saturation: f32 = 1;
  satDip: f32 = 0;
  profile: usize = 0;
  motion: usize = 0;
  gradient: usize = 0;

  prepare(p: Params): void {
    this.palette = p.int(0) == 0;
    this.gradient = p.lut(1);
    this.alternate = p.int(34) == 1;
    this.transition = p.get(35);
    this.hueShift = p.get(36);
    this.hueRange = p.get(37);
    this.saturation = p.get(38);
    this.satDip = p.get(39);
    this.profile = p.lut(40);
    this.motion = p.lut(168);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const m = sampleLut(this.motion, fract(ctx.timePhase));
    if (this.palette) {
      const g = this.gradient;
      const n = gradientCount(g);
      if (this.alternate && s.rank >= 0) {
        const i = (s.rank + <i32>Mathf.floor(m * <f32>n)) % n;
        RGB.set(gradientStopChannel(g, i, 0), gradientStopChannel(g, i, 1), gradientStopChannel(g, i, 2));
      } else {
        const u = fract(s.spatial - m);
        RGB.set(sampleGradient(g, u, this.transition, 0), sampleGradient(g, u, this.transition, 1), sampleGradient(g, u, this.transition, 2));
      }
      const level = Mathf.max(s.base0, Mathf.max(s.base1, s.base2));
      const k: f32 = level < 1e-3 ? 1.0 : level;
      out.setRgb(clamp(RGB.x * k, 0.0, 1.0), clamp(RGB.y * k, 0.0, 1.0), clamp(RGB.z * k, 0.0, 1.0));
      return;
    }
    const p = clamp(sampleSignedLut(this.profile, s.spatial - m), 0.0, 1.0);
    const hue = this.hueShift + this.hueRange * (2.0 * p - 1.0);
    rgbToHsl(s.base0, s.base1, s.base2, HSL);
    // Hue is meaningless at near-black.
    const h = HSL.z < 1e-3 ? HSL.x : fract(HSL.x + hue / 360.0);
    hslToRgb(h, clamp(HSL.y * this.saturation, 0.0, 1.0), HSL.z, RGB);
    // White dip: blend toward white at the programmed brightness where the profile peaks.
    const w = this.satDip * p;
    const level = Mathf.max(s.base0, Mathf.max(s.base1, s.base2));
    out.setRgb(
      clamp(RGB.x + (level - RGB.x) * w, 0.0, 1.0),
      clamp(RGB.y + (level - RGB.y) * w, 0.0, 1.0),
      clamp(RGB.z + (level - RGB.z) * w, 0.0, 1.0),
    );
  }
}

register(new ColorShift());
