/**
 * `trigger` params (ABI 1.3): momentary input state, its wire encoding and
 * the host-side edge logic (press / release / multi-click counting).
 *
 * The value stores absolute engine-clock timestamps, so it only changes on
 * an edge (no per-frame re-encoding) and `render` stays a pure function of
 * (ctx, sample, params): the SDK derives "ms since press/release" from
 * `ctx.timeMs`.
 */
import type { TriggerParam, TriggerValue } from '@pixelmapper/extension-api';

/** Wire timestamp of "never" (ms); far enough in the past that envelopes are over. */
export const TRIGGER_NEVER_MS = -1e9;
/** Default multi-click window (ms between a release and the next press). */
export const DEFAULT_MULTI_CLICK_MS = 350;
/** Idle state (never pressed). */
export const TRIGGER_IDLE: Readonly<TriggerValue> = Object.freeze({ pressed: false });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a trigger default / value; null when OK. */
export function checkTrigger(v: unknown): string | null {
  const t = v as Partial<TriggerValue> | null;
  if (!t || typeof t !== 'object' || typeof t.pressed !== 'boolean') return 'must be { pressed: boolean } (e.g. { "pressed": false })';
  if (t.pressedAt !== undefined && !isNum(t.pressedAt)) return 'pressedAt must be a number';
  if (t.releasedAt !== undefined && !isNum(t.releasedAt)) return 'releasedAt must be a number';
  if (t.clicks !== undefined && !(Number.isInteger(t.clicks) && t.clicks >= 0)) return 'clicks must be an integer ≥ 0';
  return null;
}

/** Wire form: `pressed, pressedAt, releasedAt, clicks` (invalid/missing → idle). */
export function writeTrigger(buf: Float32Array, offset: number, v: TriggerValue | undefined): void {
  const t = v && typeof v === 'object' ? v : TRIGGER_IDLE;
  buf[offset] = t.pressed ? 1 : 0;
  buf[offset + 1] = isNum(t.pressedAt) ? t.pressedAt : TRIGGER_NEVER_MS;
  buf[offset + 2] = isNum(t.releasedAt) ? t.releasedAt : TRIGGER_NEVER_MS;
  buf[offset + 3] = isNum(t.clicks) ? Math.max(0, Math.round(t.clicks)) : 0;
}

/**
 * Applies a press (`pressed = true`) or release edge at engine time `nowMs`.
 * A press within `multiClickMs` of the previous release continues the click
 * burst (`clicks + 1`), otherwise starts a new one (`clicks = 1`). Repeated
 * edges in the same direction return the value unchanged.
 */
export function triggerEdge(
  prev: TriggerValue | undefined,
  pressed: boolean,
  nowMs: number,
  multiClickMs: number = DEFAULT_MULTI_CLICK_MS,
): TriggerValue {
  const p = prev && typeof prev === 'object' ? prev : TRIGGER_IDLE;
  if (p.pressed === pressed) return p as TriggerValue;
  if (!pressed) return { ...p, pressed: false, releasedAt: nowMs };
  const inBurst = isNum(p.releasedAt) && (p.clicks ?? 0) > 0 && nowMs - p.releasedAt <= multiClickMs;
  return { ...p, pressed: true, pressedAt: nowMs, clicks: inBurst ? (p.clicks ?? 0) + 1 : 1 };
}

/** Multi-click window of a param definition. */
export function multiClickMsOf(def: Pick<TriggerParam, 'multiClickMs'>): number {
  return isNum(def.multiClickMs) && def.multiClickMs > 0 ? def.multiClickMs : DEFAULT_MULTI_CLICK_MS;
}
