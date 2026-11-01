import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { useEngineStore } from '~/stores/engine-store';

/** How long a pulse stays lit (ms). */
const PULSE_MS = 120;
/** Retry interval while the clock is frozen (0 BPM). */
const FROZEN_RETRY_MS = 250;

/**
 * Beat pulse for tempo indicators (Beat widget, header): `true` for a short
 * moment on every whole **base** beat — the music, independent of the speed
 * multiplier.
 *
 * Each pulse schedules the next one from the rendered base beat
 * (`engineStore.baseBeatAt`), so the indicator follows tempo changes and the
 * tap nudge that slides the beat grid onto the user's taps.
 */
export function useBeatPulse(): Ref<boolean> {
  const engineStore = useEngineStore();
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Last beat index that pulsed (guards against a double pulse when a timer fires early). */
  let lastBeat = -Infinity;

  /** Lights the indicator briefly. */
  function pulse() {
    active.value = true;
    setTimeout(() => { active.value = false; }, PULSE_MS);
  }

  /** Arms a timer for the next whole beat. */
  function schedule() {
    if (timer) clearTimeout(timer);
    const bpm = engineStore.baseBpm;
    if (bpm <= 0) {
      timer = setTimeout(schedule, FROZEN_RETRY_MS);
      return;
    }
    const beat = engineStore.baseBeatAt();
    const next = Math.max(Math.floor(beat) + 1, lastBeat + 1);
    timer = setTimeout(() => {
      lastBeat = next;
      pulse();
      schedule();
    }, ((next - beat) * 60000) / bpm);
  }

  /** Restarts the schedule (tempo or epoch changed). */
  function restart() {
    lastBeat = Math.floor(engineStore.baseBeatAt());
    schedule();
  }

  onMounted(() => {
    watch([() => engineStore.baseBpm, () => engineStore.clockEpoch], restart, { immediate: true });
  });
  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });
  return active;
}
