<script setup lang="ts">
/**
 * Device dialog of the connector card: opened by clicking an RDM device row
 * (`DeviceRow`). Title = device label (`deviceLabel`) with the model below;
 * body = `RdmDevicePanel` with the patch editors (address and personality
 * go to the device; an effectively linked fixture follows), for the
 * fixture linked to the UID if there is one.
 *
 * Usage: `<DeviceDialog v-model:open="open" :uid="uid" @add="addDevice(uid)" />`
 *
 * Teleported to `<body>` and styled like the app's dialog (extensions may
 * not import the app's UI components; cf. `FirmwareUpdateDialog`). The
 * root carries `data-overlay-root`, so clicks inside do not close the
 * properties sidebar (`FLOATING_OVERLAY_SELECTORS`). Escape and a click on
 * the backdrop close it. Closing unmounts the panel: Identify switched on
 * here is switched off (`useDeviceIdentify`), running firmware updates
 * continue (they live in the update manager).
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import { listFixtures } from '@pixelmapper/extension-api';
import type { RdmUid } from '../bridge/protocol-model';
import { deviceLabel } from '../devices/addressing';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { linkedFixturesOf } from '../devices/link';
import RdmDevicePanel from '../inspector/RdmDevicePanel.vue';

const props = withDefaults(defineProps<{
  /** Visible (`v-model:open`). */
  open: boolean;
  /** The device shown. */
  uid: RdmUid;
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>(), { runtime: undefined });

const emit = defineEmits<{
  'update:open': [open: boolean];
  /** “Add” was clicked: the parent adds the device to the canvas. */
  'add': [];
}>();

const runtime = computed(() => props.runtime ?? getDeviceRuntime());
const device = computed(() => runtime.value?.store.get(props.uid));
/** Fixture linked to the device (any link state); reactive through the model tick. */
const fixtureId = computed(() => linkedFixturesOf(listFixtures()).find(f => f.link.uid === props.uid)?.fixtureId ?? null);

const title = computed(() => (device.value ? deviceLabel(device.value) : props.uid));
/** Model under the title, left out when the title already is the model. */
const model = computed(() => {
  const m = device.value?.description?.deviceModelDescription?.trim();
  return m && m !== title.value ? m : null;
});
/** Id of the heading (unique per device, for `aria-labelledby`). */
const titleId = computed(() => `pm-device-dialog-title-${props.uid.replace(/[^\w-]/g, '-')}`);

/** Closes the dialog. */
function close() {
  emit('update:open', false);
}

/** Escape closes. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

watch(() => props.open, (open) => {
  if (open) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
}, { immediate: true });
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-overlay-root
      class="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 animate-in fade-in-0"
      data-device-dialog
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="relative grid max-h-[85vh] w-full max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:max-w-lg"
      >
        <div class="flex min-w-0 flex-col gap-1 pr-6">
          <h2 :id="titleId" class="truncate text-lg font-semibold leading-none" :title="title" data-device-title>{{ title }}</h2>
          <p v-if="model" class="truncate text-xs text-muted-foreground" data-device-model>{{ model }}</p>
        </div>
        <button
          type="button"
          class="absolute right-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden"
          aria-label="Close"
          data-close
          @click="close"
        >
          <!-- "x" icon -->
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div class="min-h-0 overflow-y-auto pr-1">
          <RdmDevicePanel :uid="uid" :fixture-id="fixtureId" :runtime="runtime" patch-editable @add="emit('add')" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
