/**
 * Built-in modifier: Noise (port of the former Rust NoiseEffect).
 *
 * Step duration = 1 / phaseSpeed (infinite when the speed is frozen); time
 * is the shared clock (ctx.timeMs), so all clients flicker identically.
 */
import { Modifier, Frame, Sample, Out, Params, register, seededRandom, fnv1aPos, crossfade, perlin2, clamp } from "@pixelmapper/plugin-sdk";

const WHITE: i32 = 0;
const PERLIN: i32 = 1;

class Noise extends Modifier {
  noiseType: i32 = 0;
  scale: f32 = 1;
  cv: f32 = 0;
  fade: f32 = 0;
  threshold: f32 = 0;

  prepare(p: Params): void {
    this.noiseType = p.int(0);
    this.scale = p.get(1);
    this.cv = clamp(p.get(2), 0.0, 1.0);
    this.fade = p.get(3);
    this.threshold = clamp(p.get(4), 0.0, 1.0);
  }

  /** Jittered random step value for one seed (white noise). */
  white(seed: u32, timeMs: f32, baseDur: f32): f32 {
    if (!isFinite(baseDur)) return seededRandom(seed) * 2.0 - 1.0;
    const jitter = seededRandom(seed + 0xA1) * 0.8 + 0.6;
    const phaseOffset = seededRandom(seed + 0xB2) * baseDur;
    const dur = baseDur * jitter;
    const localT = timeMs + phaseOffset;
    const tick = <u32>(localT / dur);
    const elapsed = localT - <f32>tick * dur;
    const curr = seededRandom(seed + tick * 997) * 2.0 - 1.0;
    const prev = seededRandom(seed + (tick - 1) * 997) * 2.0 - 1.0;
    return crossfade(prev, curr, elapsed, dur, this.fade);
  }

  /** Synchronized random step value for one seed. */
  step(seed: u32, timeMs: f32, dur: f32): f32 {
    if (!isFinite(dur)) return seededRandom(seed) * 2.0 - 1.0;
    const tick = <u32>(timeMs / dur);
    const elapsed = timeMs - <f32>tick * dur;
    const curr = seededRandom(seed + tick * 1013) * 2.0 - 1.0;
    const prev = seededRandom(seed + (tick - 1) * 1013) * 2.0 - 1.0;
    return crossfade(prev, curr, elapsed, dur, this.fade);
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const dur: f32 = ctx.phaseSpeed > 0.0 ? Mathf.max(1000.0 / ctx.phaseSpeed, 1.0) : Infinity;
    const posSeed = fnv1aPos(s.x, s.y);
    const channelSeed = s.channelSeed;
    const chSeed = posSeed ^ (channelSeed * 0x9e3779b9);
    let raw: f32;
    if (this.noiseType == WHITE) {
      const v0 = this.white(posSeed, ctx.timeMs, dur);
      const v1 = this.white(chSeed, ctx.timeMs, dur);
      raw = v0 + (v1 - v0) * this.cv;
    } else if (this.noiseType == PERLIN) {
      const speedFactor: f32 = isFinite(dur) ? 1000.0 / dur : 0.0;
      const cs = <f32>channelSeed * 0.00001;
      const ox = this.cv * (cs * 17.3 + 13.7);
      const oy = this.cv * (cs * 31.7 + 27.1);
      raw = perlin2(s.x * this.scale * 4.0 + ctx.timeMs / 1000.0 * speedFactor + ox, s.y * this.scale * 4.0 + oy);
    } else {
      const v0 = this.step(posSeed, ctx.timeMs, dur);
      const v1 = this.step(chSeed, ctx.timeMs, dur);
      raw = v0 + (v1 - v0) * this.cv;
    }

    // Threshold gate: map to [0, 1], cut below the threshold, rescale.
    const t = this.threshold;
    if (t <= 0.0) {
      out.set(0, raw);
      return;
    }
    const norm = (raw + 1.0) * 0.5;
    if (norm < t) out.set(0, -1.0);
    else if (t >= 1.0) out.set(0, 1.0);
    else out.set(0, (norm - t) / (1.0 - t) * 2.0 - 1.0);
  }
}

register(new Noise());
