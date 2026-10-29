/**
 * Vue wrapper around the framework-free bridge status (`bridge-status.ts`):
 * mirrors a status source into a read-only `shallowRef`.
 */
import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue';
import type { DeepReadonly, Ref, ShallowRef } from 'vue';
import { bridgeStatus } from './bridge-status';
import type { BridgeStatus, BridgeStatusListener } from './bridge-status';

/** Anything exposing the bridge status subscribe API. */
export interface BridgeStatusSource {
  subscribe(listener: BridgeStatusListener): () => void;
}

/**
 * Returns a read-only ref following `source`. Inside a component / effect
 * scope the subscription ends with the scope; module-level callers keep it.
 */
export function useBridgeStatus(source: BridgeStatusSource): Readonly<Ref<DeepReadonly<BridgeStatus>>> {
  const state: ShallowRef<BridgeStatus> = shallowRef(bridgeStatus('disabled'));
  const unsubscribe = source.subscribe((status) => {
    state.value = status;
  });
  if (getCurrentScope()) onScopeDispose(unsubscribe);
  return readonly(state);
}
