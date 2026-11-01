/**
 * Live phase of a modifier on the main thread (plan M5.5): the instance's
 * `timePhase` from the shared clock (same formula as the engine's speed
 * phase), for curve playheads, the steps grid and the endless strip.
 * Updates on animation frames, throttled to ~30 fps; pauses while hidden.
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { speedPhase } from '~/utils/plugins/preview-pool';
import { useEngineStore } from '~/stores/engine-store';

/** Clock state shared by previews. */
export interface ClockSample {
  /** Speed time: ms since the clock epoch scaled by the speed multiplier. */
  timeMs: number;
  /** Beats since the clock epoch, as the engine renders them (tempo history, tap nudges). */
  beatTime: number;
  bpm: number;
}

/** Reads the shared clock now (falls back to a local clock without the store). */
export function sampleClock(): ClockSample {
  try {
    const store = useEngineStore();
    const bpm = store.engine.globalBpm.value || 120;
    const now = Date.now();
    return { timeMs: store.speedTimeAt(now), beatTime: store.beatTimeAt(now), bpm };
  }
  catch {
    const timeMs = performance.now();
    return { timeMs, beatTime: (timeMs * 120) / 60000, bpm: 120 };
  }
}

/** Frame interval (ms) of the live phase. */
const FRAME_MS = 1000 / 30;

/**
 * Reactive live phase of `m()`: `timePhase` (unwrapped cycles), `position`
 * (fract, 0–1) and the clock sample used.
 */
export function useModifierPhase(m: () => ModifierInstance | null | undefined): {
  timePhase: Ref<number>;
  position: Ref<number | null>;
  clock: Ref<ClockSample>;
} {
  const timePhase = ref(0);
  const position = ref<number | null>(null);
  const clock = ref<ClockSample>({ timeMs: 0, beatTime: 0, bpm: 120 });
  let raf = 0;
  let lastFrame = 0;

  /** One update (exported via the loop). */
  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    if (now - lastFrame < FRAME_MS || (typeof document !== 'undefined' && document.hidden)) return;
    lastFrame = now;
    const inst = m();
    if (!inst) {
      position.value = null;
      return;
    }
    const c = sampleClock();
    clock.value = c;
    timePhase.value = speedPhase(inst.speed, c.timeMs, c.beatTime);
    position.value = inst.speed.mode === 'infinite' ? null : timePhase.value - Math.floor(timePhase.value);
  }

  onMounted(() => { raf = requestAnimationFrame(tick); });
  onBeforeUnmount(() => cancelAnimationFrame(raf));
  return { timePhase, position, clock };
}
