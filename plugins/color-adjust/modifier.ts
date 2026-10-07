/**
 * Built-in modifier: Color Adjust (port of the former Rust ColorEffect
 * post-process). Absolute RGB output: the host mixes it in by strength.
 */
import { Modifier, Frame, Sample, Out, Params, register, Vec3, rgbToHsl, hslToRgb, evaluateShape, fract, clamp } from "@pixelmapper/plugin-sdk";

const HSL = new Vec3();
const RGB = new Vec3();

class ColorAdjust extends Modifier {
  hueShift: f32 = 0;
  saturation: f32 = 1;
  hueRange: f32 = 0;
  satRange: f32 = 0;
  shape: i32 = 0;
  shapeParam: f32 = 0.5;

  prepare(p: Params): void {
    this.hueShift = p.get(0);
    this.saturation = p.get(1);
    this.hueRange = p.get(2);
    this.satRange = p.get(3);
    this.shape = p.int(4);
    this.shapeParam = p.get(5);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const cycle = evaluateShape(this.shape, fract(s.phase), this.shapeParam);
    const hue = this.hueShift + cycle * this.hueRange;
    const sat = clamp(this.saturation + cycle * this.satRange, 0.0, 2.0);
    rgbToHsl(s.base0, s.base1, s.base2, HSL);
    // Hue is meaningless at near-black.
    const h = HSL.z < 1e-3 ? HSL.x : fract(HSL.x + hue / 360.0);
    hslToRgb(h, clamp(HSL.y * sat, 0.0, 1.0), HSL.z, RGB);
    out.setRgb(clamp(RGB.x, 0.0, 1.0), clamp(RGB.y, 0.0, 1.0), clamp(RGB.z, 0.0, 1.0));
  }
}

register(new ColorAdjust());
