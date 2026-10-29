import type { ParamValue } from '@pixelmapper/extension-api';
import { getManifest } from '~/utils/plugins/plugin-store';
import { engineClockMs, paramsAfterTriggerEdge } from '~/utils/plugins/trigger-param';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

/**
 * Presses or releases trigger param `key` of modifier `effectId` (ABI 1.3).
 *
 * Shared by the modifier card's press-and-hold button and live `button`
 * widgets mapped via `effect-param`. The edge is stamped with the engine
 * clock and written straight into the instance's params — momentary input,
 * so no undo step — then sent to the engine and synced to collaborators via
 * the existing `modifier.update` live op (same path as card param edits).
 * Returns false when the modifier or trigger param is unknown.
 */
export function setEffectTrigger(effectId: string, key: string, pressed: boolean): boolean {
  const engineStore = useEngineStore();
  const effect = engineStore.modifiers.find((e: { id: string }) => e.id === effectId);
  if (!effect) return false;
  const next = paramsAfterTriggerEdge(getManifest(effect.plugin), effect.params, key, pressed, engineClockMs(engineStore.clockEpoch));
  if (!next) return false;
  effect.params = next as Record<string, ParamValue>;
  engineStore.triggerCanvasSync?.();
  const liveBus = useLiveBusStore();
  queueMicrotask(() => liveBus.dispatch('modifier.update', { effectId, changes: {}, paramChanges: { [key]: next[key] } }));
  return true;
}
