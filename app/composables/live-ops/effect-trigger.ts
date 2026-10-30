import type { ParamValue } from '@pixelmapper/extension-api';
import { getManifest } from '~/utils/plugins/plugin-store';
import { engineClockMs, paramsAfterTriggerEdge } from '~/utils/plugins/trigger-param';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

/** Current engine-clock time in ms (`Frame.timeMs` the plugins see). */
export function currentEngineClockMs(): number {
  return engineClockMs(useEngineStore().clockEpoch);
}

/**
 * Presses or releases trigger param `key` of modifier `effectId` (ABI 1.3).
 *
 * Shared by the modifier card's press-and-hold button, live `button`
 * widgets mapped via `effect-param` and the `modifiers.trigger` operation.
 * The edge is stamped with the engine clock (`clockMs`, default: now) and
 * written straight into the instance's params — momentary input, so no undo
 * step — then sent to the engine and synced to collaborators via the
 * existing `modifier.update` live op (same path as card param edits).
 * Returns false when the modifier or trigger param is unknown, or when the
 * edge changes nothing (pressing an already pressed trigger).
 */
export function setEffectTrigger(effectId: string, key: string, pressed: boolean, clockMs: number = currentEngineClockMs()): boolean {
  const engineStore = useEngineStore();
  const effect = engineStore.modifiers.find((e: { id: string }) => e.id === effectId);
  if (!effect) return false;
  const next = paramsAfterTriggerEdge(getManifest(effect.plugin), effect.params, key, pressed, clockMs);
  if (!next) return false;
  effect.params = next as Record<string, ParamValue>;
  engineStore.triggerCanvasSync?.();
  const liveBus = useLiveBusStore();
  queueMicrotask(() => liveBus.dispatch('modifier.update', { effectId, changes: {}, paramChanges: { [key]: next[key] } }));
  return true;
}
