/**
 * Built-in modifier: Mirror Runner (effect-authoring reference, plan M5).
 * A runner bounces along every multi-head fixture (LED tube, pixel bar):
 *
 *   p     = (headIndex + 0.5) / headCount      position along the tube
 *   p     = 1 − p  when the head is on the mirrored half of the room (u or v
 *                  beyond the room center) XOR reverse
 *   head  = pingPong(timePhase)                runner 0 → 1 → 0 per cycle
 *   since = cycles since the runner last passed p (pure function of time)
 *   v     = (1 − since / tailTime)²            fading comet tail
 *
 * The tail is a *time* delay, so it folds back naturally at the bounce.
 * A full trip over the tube takes half a cycle, so a tail of `tail` tube
 * lengths lasts `tail / 2` cycles. Room coordinates (`Sample.u/v`) decide
 * the mirror side, so the mirror line is the center of the rig.
 * Output `scale`: 1 keeps the programmed level, 0 is dark.
 * Params (slots): tail 0, mirror 1 (0 left/right, 1 front/back, 2 off),
 * reverse 2.
 */
import { Modifier, Frame, Sample, Out, Params, register, fract } from "@pixelmapper/plugin-sdk";

/** `mirror` enum indices. */
const MIRROR_LEFT_RIGHT: i32 = 0;
const MIRROR_FRONT_BACK: i32 = 1;

class MirrorRunner extends Modifier {
  /** Tail duration in cycles (tail length / 2). */
  tailTime: f32 = 0.175;
  mirror: i32 = MIRROR_LEFT_RIGHT;
  reverse: bool = false;

  /** Reads params in manifest order. */
  prepare(p: Params): void {
    this.tailTime = Mathf.max(p.get(0), 0.001) * 0.5;
    this.mirror = p.int(1);
    this.reverse = p.bool(2);
  }

  /** Pure: level of one head from its position along the tube and the time phase. */
  render(ctx: Frame, s: Sample, out: Out): void {
    const n = s.headCount > 0 ? s.headCount : 1;
    let p: f32 = (<f32>s.headIndex + 0.5) / <f32>n;
    // Mirror: the far half of the room runs the other way.
    let flip = this.reverse;
    if (this.mirror == MIRROR_LEFT_RIGHT && s.u > 0.5) flip = !flip;
    else if (this.mirror == MIRROR_FRONT_BACK && s.v > 0.5) flip = !flip;
    if (flip) p = 1.0 - p;

    // The runner pingPong(t) passes p rising at t = k + p/2 and falling at
    // t = k + 1 − p/2; `since` is the time since the latest of these passes.
    const f: f32 = fract(ctx.timePhase);
    const rise: f32 = p * 0.5;
    const fall: f32 = 1.0 - rise;
    let since: f32;
    if (f >= fall) since = f - fall;
    else if (f >= rise) since = f - rise;
    else since = f + rise; // falling pass of the previous cycle
    const v: f32 = since < this.tailTime ? 1.0 - since / this.tailTime : 0.0;
    out.setScalar(v * v);
  }
}

register(new MirrorRunner());
