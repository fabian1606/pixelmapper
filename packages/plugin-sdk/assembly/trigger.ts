/**
 * Reading `trigger` params (ABI 1.3): momentary buttons (hold / release /
 * double-click). A trigger occupies 4 param slots starting at `slot`
 * (`pressed, pressedAt, releasedAt, clicks`, times in engine-clock ms); these
 * helpers turn them into "how long ago" values relative to `ctx.timeMs`, so
 * `render` stays a pure function of time.
 *
 * ```ts
 * // params: [0] trigger "hit" (4 slots), [4] number "decay"
 * const held = triggerPressed(this.params, 0);
 * const sinceRelease = triggerMsSinceRelease(this.params, 0, ctx);
 * if (triggerClicks(this.params, 0) >= 2) { … double click: flash … }
 * else if (held) out.setScalar(0.0);                                  // hold = blackout
 * else out.setScalar(envelope(sinceRelease, 0.0, this.params.get(4))); // release = wave
 * ```
 */
import { Frame, Params } from "./core";

/** Param slots of a trigger. */
export const TRIGGER_SLOTS: i32 = 4;
/** "Never happened": returned by the ms-since helpers before the first press/release (1e9 ms ≈ 11 days). */
export const TRIGGER_NEVER: f32 = 1e9;

/** Stored timestamps below this mean "never" (the host writes −1e9). */
const NEVER_STAMP: f32 = -1e8;

/** Converts a stored timestamp into ms before `ctx.timeMs` (≥ 0; `TRIGGER_NEVER` when never). */
@inline function since(stamp: f32, ctx: Frame): f32 {
  if (stamp < NEVER_STAMP) return TRIGGER_NEVER;
  const d = ctx.timeMs - stamp;
  return d > 0.0 ? d : 0.0;
}

/** True while the trigger is held down. */
@inline export function triggerPressed(params: Params, slot: i32): bool {
  return params.get(slot) >= 0.5;
}

/**
 * Milliseconds since the last press (also while still held). `TRIGGER_NEVER`
 * before the first press. Feed it to `envelope(...)` for attack/decay looks.
 */
export function triggerMsSincePress(params: Params, slot: i32, ctx: Frame): f32 {
  return since(params.get(slot + 1), ctx);
}

/**
 * Milliseconds since the last release. While the trigger is held this still
 * refers to the *previous* release, so check `triggerPressed` first.
 * `TRIGGER_NEVER` before the first release.
 */
export function triggerMsSinceRelease(params: Params, slot: i32, ctx: Frame): f32 {
  return since(params.get(slot + 2), ctx);
}

/**
 * Presses in the current click burst: 1 = single click, 2 = double click, …
 * (a press within the param's `multiClickMs`, default 350 ms, of the
 * previous release continues the burst). 0 before the first press.
 */
@inline export function triggerClicks(params: Params, slot: i32): i32 {
  return params.int(slot + 3);
}
