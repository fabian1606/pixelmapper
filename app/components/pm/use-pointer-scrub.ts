/**
 * Pointer-drag helper shared by the `pm.*` default inputs.
 *
 * Captures the pointer on down, reports moves, and brackets the interaction
 * with `onStart`/`onEnd` so inputs can emit `scrubStart`/`scrubEnd` (one undo
 * step per drag).
 */
import { onBeforeUnmount, ref } from 'vue';

/** Callbacks of one scrub interaction. */
export interface PointerScrubHandlers {
  /** Pointer went down on the element (already captured). */
  onStart(e: PointerEvent, el: HTMLElement): void;
  /** Pointer moved while captured. */
  onMove(e: PointerEvent, el: HTMLElement): void;
  /** Pointer released or cancelled. */
  onEnd(): void;
}

/** Returns pointer handlers to bind on the scrub target plus a `scrubbing` flag. */
export function usePointerScrub(handlers: PointerScrubHandlers, isDisabled: () => boolean = () => false) {
  const scrubbing = ref(false);
  let target: HTMLElement | null = null;

  function onPointerDown(e: PointerEvent) {
    if (isDisabled() || e.button !== 0) return;
    e.preventDefault();
    target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    scrubbing.value = true;
    handlers.onStart(e, target);
  }

  function onPointerMove(e: PointerEvent) {
    if (!scrubbing.value || !target) return;
    handlers.onMove(e, target);
  }

  function onPointerUp() {
    if (!scrubbing.value) return;
    scrubbing.value = false;
    target = null;
    handlers.onEnd();
  }

  // Never leave an interaction open (e.g. unmount mid-drag).
  onBeforeUnmount(onPointerUp);

  return {
    scrubbing,
    bind: {
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: onPointerUp,
      onPointercancel: onPointerUp,
    },
  };
}

/** Clamps `v` into `[min, max]` and snaps to `step` (if given). */
export function clampStep(v: number, min: number, max: number, step?: number): number {
  let out = Math.max(min, Math.min(max, v));
  if (step && step > 0) out = Math.round((out - min) / step) * step + min;
  return Math.max(min, Math.min(max, out));
}
