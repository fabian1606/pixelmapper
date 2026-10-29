/**
 * Frame loop of the effect hover preview: requestAnimationFrame with a
 * frame-time throttle (default 30 fps), elapsed time from `start()`, and
 * `stop()`. Under reduced motion `start()` draws a single static frame and
 * never schedules another one. Clock and raf are injectable for tests.
 */

/** Draws one frame; return `false` to stop the loop (e.g. nothing to animate). */
export type EffectDraw = (elapsedMs: number) => boolean | void;

export interface EffectAnimatorOptions {
  draw: EffectDraw;
  /** Target frame rate (default 30). */
  fps?: number;
  /** `prefers-reduced-motion: reduce`: draw one frame only. */
  reducedMotion?: boolean;
  /** Injectable clock (default `performance.now`). */
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (handle: number) => void;
}

export interface EffectAnimator {
  /** Starts (or restarts after `stop`) the loop; draws the first frame immediately. */
  start(): void;
  /** Cancels the pending frame. */
  stop(): void;
  /** True while frames are scheduled. */
  readonly running: boolean;
}

/** Creates a throttled rAF loop around `opts.draw`. */
export function createEffectAnimator(opts: EffectAnimatorOptions): EffectAnimator {
  const fps = Math.max(1, opts.fps ?? 30);
  // 1 ms tolerance: a 60 Hz display delivers frames every ~16.7 ms, so a
  // 33.3 ms budget must accept 33.2 ms to land on every second frame.
  const interval = 1000 / fps - 1;
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? (cb => requestAnimationFrame(cb));
  const caf = opts.caf ?? (h => cancelAnimationFrame(h));

  let handle: number | null = null;
  let startedAt = 0;
  let lastFrame = 0;

  /** Draws at `t`; returns whether the loop continues. */
  const drawAt = (t: number) => opts.draw(t - startedAt) !== false;

  const tick = () => {
    handle = null;
    const t = now();
    if (t - lastFrame >= interval) {
      lastFrame = t;
      if (!drawAt(t)) return;
    }
    handle = raf(tick);
  };

  return {
    start() {
      if (handle !== null) return;
      startedAt = now();
      lastFrame = startedAt;
      const more = drawAt(startedAt);
      if (opts.reducedMotion || !more) return;
      handle = raf(tick);
    },
    stop() {
      if (handle !== null) caf(handle);
      handle = null;
    },
    get running() {
      return handle !== null;
    },
  };
}
