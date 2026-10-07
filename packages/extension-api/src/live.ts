/**
 * Live-value channel (ADR §5.5, D22).
 *
 * Per-frame data is opt-in and pull-based: the host only extracts what is
 * currently subscribed. Use `useLiveValue` for throttled reactive values in
 * templates and `onFrame` for non-reactive per-frame work (canvas drawing).
 */
import type { MaybeRef, ShallowRef } from 'vue';
import type { FixtureId, Signature } from './model';
import { getHostApi } from './host';

/** Something that can be observed per frame. */
export type LiveTarget =
  /** Rendered DMX value 0–255 (coarse byte) of one channel. */
  | { kind: 'channel'; fixtureId: FixtureId; channelIndex: number }
  /** Normalized signature tuple after modifiers (available from plan P3). */
  | { kind: 'signature'; fixtureId: FixtureId; signature: Signature }
  /** Beat clock. */
  | { kind: 'beat' }
  /** One full universe (512 bytes). `universe` is 1-based. */
  | { kind: 'universe'; universe: number };

/** Beat clock state. */
export interface BeatInfo {
  /** Beats elapsed since the clock epoch (fractional). */
  beatTime: number;
  /** Current tempo. */
  bpm: number;
  /** Phase within the current beat, 0–1. */
  phase: number;
}

/** Value type delivered for a target. */
export type LiveValueOf<T extends LiveTarget> =
  T extends { kind: 'channel' } ? number
    : T extends { kind: 'signature' } ? Float32Array
      : T extends { kind: 'beat' } ? BeatInfo
        : T extends { kind: 'universe' } ? Uint8Array
          : never;

/** Non-reactive frame data passed to `onFrame` callbacks. */
export interface LiveFrame {
  /** Engine time in milliseconds. */
  timeMs: number;
  /** Beat clock state. */
  beat: BeatInfo;
  /**
   * Full flat DMX buffer of all universes (index = absolute address − 1).
   * Do not retain beyond the callback; it is reused between frames.
   */
  dmx: Uint8Array;
}

/** Options of `useLiveValue`. */
export interface LiveValueOptions {
  /** Update rate. Default 30, max 60. */
  fps?: number;
}

/** Options of `onFrame`. */
export interface OnFrameOptions {
  /** Targets this callback needs, so the host can subscribe the worker. */
  targets?: LiveTarget[];
}

/**
 * Subscribes to a live value. Returns a throttled `shallowRef` that updates
 * only while the calling component is mounted and visible.
 *
 * @example
 * const dim = useLiveValue({ kind: 'channel', fixtureId: id, channelIndex: 0 });
 */
export function useLiveValue<T extends LiveTarget>(
  target: MaybeRef<T>,
  opts?: LiveValueOptions,
): Readonly<ShallowRef<LiveValueOf<T> | undefined>> {
  return getHostApi().useLiveValue(target, opts);
}

/**
 * Registers a per-frame callback (no reactivity, typed arrays). Disposed
 * automatically when the calling component unmounts. MUST NOT drive Vue state
 * at frame rate.
 */
export function onFrame(cb: (frame: LiveFrame) => void, opts?: OnFrameOptions): void {
  getHostApi().onFrame(cb, opts);
}
