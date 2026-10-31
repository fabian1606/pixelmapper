import { reactive } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { setActivePreset } from '~/components/engine/composables/preset-activation';
import { getColorOverride, setColorOverride } from './color-override-ops';
import type { RGB } from '~/utils/live/color-utils';
import { latchedEntries, restoreLatched, type LatchedEntry } from './button-runtime';

/**
 * "Step back" for the live show: every change that *stays* (a preset that
 * becomes active, a color override, a toggled blackout, a forever speed, tap
 * tempo, Stop all, a section press) first records the look from before; Step back restores it.
 *
 * Momentary things (held flashes, While pressing, timed actions) are not steps
 * — they end by themselves. Fader moves on channels / dimmers / modifier
 * params are not recorded either: the physical fader would no longer match.
 *
 * Separate from the edit undo (Cmd+Z, use-history): that one undoes changes to
 * the project, this one only the running show. Local to this tab; restoring
 * broadcasts the result like any other live change.
 */

/** The parts of the running look that Step back restores. */
interface LiveLook {
  presetId: string | null;
  /** Color override on the active preset (color wheel, color-variant section), null = own colors. */
  color: RGB | null;
  speedMultiplier: number;
  bpm: number;
  latched: LatchedEntry[];
  sectionMembers: Map<string, Set<string>>;
}

interface LiveStep {
  look: LiveLook;
  /** Steps with the same key in quick succession merge (e.g. tap tempo). */
  coalesce?: string;
  at: number;
}

const MAX_STEPS = 50;
const COALESCE_MS = 2000;

const steps: LiveStep[] = [];
/** Reactive count, so a Step back button could show whether it can step back. */
export const liveHistory = reactive({ size: 0 });
let restoring = false;

function captureLook(): LiveLook {
  const engineStore = useEngineStore();
  const members = useLiveModeStore().activeSectionMembers;
  return {
    presetId: engineStore.selectedPresetId,
    color: getColorOverride(engineStore.selectedPresetId),
    speedMultiplier: engineStore.speedMultiplier,
    bpm: engineStore.baseBpm,
    latched: latchedEntries(),
    sectionMembers: new Map([...members].map(([id, set]) => [id, new Set(set)])),
  };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every(x => b.has(x));
}

function sameColor(a: RGB | null, b: RGB | null): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function sameLook(a: LiveLook, b: LiveLook): boolean {
  if (!sameColor(a.color, b.color)) return false;
  if (a.presetId !== b.presetId || a.speedMultiplier !== b.speedMultiplier || a.bpm !== b.bpm) return false;
  if (!sameSet(new Set(a.latched.map(e => e.subKey)), new Set(b.latched.map(e => e.subKey)))) return false;
  const ids = new Set([...a.sectionMembers.keys(), ...b.sectionMembers.keys()]);
  return [...ids].every(id => sameSet(a.sectionMembers.get(id) ?? new Set(), b.sectionMembers.get(id) ?? new Set()));
}

/**
 * Call right *before* a lasting live change. Records the current look; a
 * no-op change is harmless (Step back skips looks equal to the current one).
 */
export function recordLiveStep(opts: { coalesce?: string } = {}): void {
  if (restoring) return;
  const now = Date.now();
  const last = steps.at(-1);
  if (opts.coalesce && last?.coalesce === opts.coalesce && now - last.at < COALESCE_MS) {
    // Keep the look from before the whole series; only extend the window.
    last.at = now;
    return;
  }
  steps.push({ look: captureLook(), coalesce: opts.coalesce, at: now });
  if (steps.length > MAX_STEPS) steps.shift();
  liveHistory.size = steps.length;
}

/** Goes back to the look before the last lasting change. Returns false when there is none. */
export function stepBack(): boolean {
  const current = captureLook();
  let step = steps.pop();
  // Skip steps that would change nothing (recorded before a no-op).
  while (step && sameLook(step.look, current)) step = steps.pop();
  liveHistory.size = steps.length;
  if (!step) return false;
  applyLook(step.look);
  return true;
}

/** Restores a recorded look without recording it as a new step. */
function applyLook(look: LiveLook): void {
  const engineStore = useEngineStore();
  const liveBus = useLiveBusStore();
  restoring = true;
  try {
    // Latched actions first: stopping a forever speed resets the multiplier,
    // which the recorded value below then overrides.
    restoreLatched(look.latched);
    const switching = engineStore.selectedPresetId !== look.presetId;
    if (switching) setActivePreset(look.presetId);
    // Switching re-applies the preset (own colors), so only an override needs setting then.
    if (look.presetId && (switching ? look.color : !sameColor(getColorOverride(look.presetId), look.color))) {
      setColorOverride(look.presetId, look.color);
    }
    if (engineStore.speedMultiplier !== look.speedMultiplier) {
      engineStore.setSpeedMultiplier(look.speedMultiplier);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier: look.speedMultiplier }));
    }
    if (engineStore.baseBpm !== look.bpm) {
      engineStore.baseBpm = look.bpm;
      queueMicrotask(() => liveBus.dispatch('engine.bpm', { bpm: look.bpm }));
    }
    useLiveModeStore().activeSectionMembers = look.sectionMembers;
  } finally {
    restoring = false;
  }
}

/** Forget all steps (e.g. tests, project switch). */
export function clearLiveHistory(): void {
  steps.length = 0;
  liveHistory.size = 0;
}
