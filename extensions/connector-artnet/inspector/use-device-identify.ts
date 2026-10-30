/**
 * Identify of the inspected device (plan M7.2, D18): on/off through the
 * device store (the shown state is the device's ACK), switched off again
 * automatically when the inspector shows another device or unmounts — a
 * tube must not keep flashing after the user moved on.
 *
 * Call inside a component's `setup` (or an effect scope).
 */
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { RdmUid } from '../bridge/protocol-model';
import type { DeviceStore } from '../devices/device-store';

/** What the inspector needs to show and switch Identify. */
export interface DeviceIdentify {
  /** The device acknowledged Identify on. */
  on: ComputedRef<boolean>;
  /** A switch is in flight. */
  busy: Ref<boolean>;
  /** Last failure (English), null after a success. */
  error: Ref<string | null>;
  /** Switches Identify of the current device. */
  set(on: boolean): Promise<void>;
}

/** Identify of the device `uid()` (null = none) in `store` (see file comment). */
export function useDeviceIdentify(store: DeviceStore | null, uid: () => RdmUid | null): DeviceIdentify {
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** Devices this inspector switched on (switched off when left). */
  const switchedOn = new Set<RdmUid>();

  const on = computed(() => {
    const id = uid();
    return !!(id && store?.get(id)?.identifying);
  });

  /** Switches Identify off for every device this inspector turned on, except `keep`. */
  function switchOff(keep: RdmUid | null) {
    for (const id of [...switchedOn]) {
      if (id === keep) continue;
      switchedOn.delete(id);
      void store?.identify(id, false).catch(err => console.warn(`[artnet] Identify off for ${id} failed:`, err));
    }
  }

  async function set(value: boolean) {
    const id = uid();
    if (!id || !store) return;
    busy.value = true;
    error.value = null;
    try {
      await store.identify(id, value);
      if (value) switchedOn.add(id);
      else switchedOn.delete(id);
    }
    catch (err) {
      error.value = (err as Error).message ?? String(err);
    }
    finally {
      busy.value = false;
    }
  }

  // Another device in the inspector: the previous one stops flashing.
  watch(uid, (now) => {
    error.value = null;
    switchOff(now);
  });
  onScopeDispose(() => switchOff(null));

  return { on, busy, error, set };
}
