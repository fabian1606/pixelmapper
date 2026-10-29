import type { ParamValue } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

/**
 * Writes plugin param `key` of modifier `effectId` from a live control
 * (slider, button, xy pad mapped via `effect-param`).
 *
 * Live input, so no undo step: the value goes straight into the instance's
 * params, to the engine, and to collaborators via the `modifier.update` live
 * op — the same path as trigger edges (`effect-trigger.ts`) and card param
 * scrubs. Returns false when the modifier is unknown.
 */
export function setEffectParam(effectId: string, key: string, value: ParamValue): boolean {
  const engineStore = useEngineStore();
  const effect = engineStore.modifiers.find((e: { id: string }) => e.id === effectId);
  if (!effect) return false;
  effect.params = { ...effect.params, [key]: value };
  engineStore.triggerCanvasSync?.();
  const liveBus = useLiveBusStore();
  queueMicrotask(() => liveBus.dispatch('modifier.update', { effectId, changes: {}, paramChanges: { [key]: value } }));
  return true;
}
