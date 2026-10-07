/**
 * `onFrame` — host implementation (ADR §5.5).
 *
 * Registers a non-reactive per-frame callback (typed arrays, no Vue state at
 * frame rate). Disposed automatically when the calling component unmounts;
 * outside a component the caller must not rely on auto-disposal.
 */
import { getCurrentInstance, onBeforeUnmount } from 'vue';
import type { LiveFrame, OnFrameOptions } from '@pixelmapper/extension-api';
import { liveHub } from '~/utils/extensions/live-hub';

/** Registers `cb` for every rendered frame; see module docs. */
export function onFrame(cb: (frame: LiveFrame) => void, opts: OnFrameOptions = {}): () => void {
  const dispose = liveHub.addFrameCallback(cb, opts.targets ?? []);
  if (getCurrentInstance()) onBeforeUnmount(dispose);
  return dispose;
}
