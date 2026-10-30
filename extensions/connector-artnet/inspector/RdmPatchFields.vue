<script setup lang="ts">
/**
 * DMX address and personality of one device, edited on the device itself
 * (device dialog, `RdmDevicePanel` with `patchEditable`). The fields show
 * what the device reports (D5). An edit is sent first (SET
 * DMX_START_ADDRESS / DMX_PERSONALITY, then re-read); when `follow` is set
 * (the device's fixture link is effective) the fixture then takes the
 * device's answer with *Take from device* — one undo step, run as this
 * extension so the patch sync does not send it back (same principle as
 * `assignFreeAddress`). Without `follow` only the device changes.
 */
import { computed, ref, watch } from 'vue';
import { useReplaceable, type FixtureId } from '@pixelmapper/extension-api';
import type { RdmUid } from '../bridge/protocol-model';
import type { DeviceRuntime } from '../devices/device-runtime';
import { takeFromDevice } from '../devices/patch-sync';
import { hasStartAddress, maxStartAddress, personalityOptions } from './device-panel-info';

const props = defineProps<{
  runtime: DeviceRuntime;
  uid: RdmUid;
  /** Linked fixture (any link state), null without one. */
  fixtureId: FixtureId | null;
  /** The fixture follows the device's answer (link effective). */
  follow: boolean;
  /** Inputs locked (device not reachable). */
  disabled?: boolean;
}>();

const NumberInput = useReplaceable('pm.numberInput');
const Select = useReplaceable('pm.select');

const busy = ref(false);
const error = ref<string | null>(null);
// Another device: drop the previous error.
watch(() => props.uid, () => { error.value = null; });

/** DEVICE_INFO and description as last read from the device. */
const device = computed(() => props.runtime.store.get(props.uid));
const info = computed(() => device.value?.info ?? null);
const options = computed(() => (info.value ? personalityOptions(info.value, device.value?.description ?? null) : []));
const addressMax = computed(() => maxStartAddress(info.value?.dmxFootprint ?? 1));
const locked = computed(() => props.disabled || busy.value);

/** Sends one edit to the device, then lets a following fixture take its answer. */
async function run(send: () => Promise<unknown>) {
  busy.value = true;
  error.value = null;
  try {
    await send();
    if (props.follow && props.fixtureId) await takeFromDevice(props.runtime, props.fixtureId);
  }
  catch (err) {
    error.value = (err as Error).message ?? String(err);
  }
  finally {
    busy.value = false;
  }
}

/** Committed start address (1…512 − footprint + 1). */
function setAddress(value: number) {
  const local = Math.round(value);
  if (!info.value || local === info.value.dmxStartAddress) return;
  if (local < 1 || local > addressMax.value) {
    error.value = `The address must be between 1 and ${addressMax.value}`;
    return;
  }
  void run(() => props.runtime.store.setStartAddress(props.uid, local));
}

/** Chosen personality (1-based, as string from the select). */
function setPersonality(value: string) {
  const n = Number(value);
  if (!info.value || !Number.isInteger(n) || n === info.value.currentPersonality) return;
  if (n < 1 || n > info.value.personalityCount) return;
  void run(() => props.runtime.store.setPersonality(props.uid, n));
}
</script>

<template>
  <div v-if="info" class="flex flex-col gap-1" data-rdm-patch>
    <div class="flex min-h-7 items-center gap-2" data-rdm-address>
      <span class="w-16 shrink-0 text-muted-foreground" title="RDM DMX_START_ADDRESS">Address</span>
      <component
        :is="NumberInput"
        v-if="hasStartAddress(info)"
        :model-value="info.dmxStartAddress"
        :min="1"
        :max="addressMax"
        :step="1"
        :precision="0"
        :disabled="locked"
        size="sm"
        class="w-20"
        @commit="setAddress"
      />
      <span v-else class="text-muted-foreground">none</span>
    </div>
    <div v-if="options.length > 1" class="flex min-h-7 items-center gap-2" data-rdm-personality>
      <span class="w-16 shrink-0 text-muted-foreground" title="RDM DMX_PERSONALITY">Mode</span>
      <component
        :is="Select"
        :model-value="String(info.currentPersonality)"
        :options="options"
        variant="dropdown"
        size="sm"
        :disabled="locked"
        class="min-w-0 flex-1"
        @update:model-value="setPersonality"
      />
    </div>
    <p v-if="busy" class="text-[10px] text-muted-foreground">Writing to the device…</p>
    <p v-if="error" class="text-[10px] text-destructive" data-rdm-patch-error>{{ error }}</p>
  </div>
</template>
