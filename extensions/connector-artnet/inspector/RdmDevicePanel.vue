<script setup lang="ts">
/**
 * Everything about one RDM device by UID (plan M7.2, D18) — the body of the
 * inspector's RDM section and of the device dialog (connector card):
 *
 * - link status (kind + reasons; “not on the canvas” without fixture) and,
 *   on Mismatch, *Write to device* / *Take from device* inline;
 * - UID, node port + universe, model, manufacturer, firmware;
 * - Identify (flashlight toggle, switched off when the UID changes or the
 *   panel unmounts), DEVICE_LABEL, the further parameters (generic form);
 * - with `patchEditable`: the device's DMX address and personality
 *   (`RdmPatchFields`: device first, an effectively linked fixture follows);
 * - “Update firmware…” for our tubes, Unlink / Re-link with a fixture, and
 *   *Add* (emitted) for a present device that is not on the canvas yet.
 *
 * Laid out for the narrow sidebar: long values truncated with a tooltip.
 * With `compact` (inspector) only the Mismatch actions stay visible; the rest
 * folds into a collapsed “Details” block.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { getFixture, type FixtureId } from '@pixelmapper/extension-api';
import type { RdmAddress } from '../bridge/protocol-messages';
import type { RdmDeviceDescription, RdmUid } from '../bridge/protocol-model';
import { PM_DEVICE, RDM_PID } from '../bridge/rdm-constants';
import { getArtNetBackend } from '../bridge/shared';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { fixtureLinkState } from '../devices/fixture-link-state';
import { relinkFixture, relinkProblem, unlinkFixture } from '../devices/link-actions';
import type { LinkStatusKind } from '../devices/link-status';
import { takeFromDevice, writeToDevice } from '../devices/patch-sync';
import { deviceStoreTubeReader } from '../firmware/device-store-reader';
import { uidManufacturer } from '../rdm/parameter-form/parameter-fields';
import TubeFirmwareButton from '../firmware/TubeFirmwareButton.vue';
import RdmParameterForm from '../rdm/parameter-form/RdmParameterForm.vue';
import { canAddDevice, devicePortText, firmwareText, portText } from './device-panel-info';
import IdentifyButton from './IdentifyButton.vue';
import RdmDeviceLabelField from './RdmDeviceLabelField.vue';
import RdmPatchFields from './RdmPatchFields.vue';
import { useDeviceIdentify } from './use-device-identify';

const props = withDefaults(defineProps<{
  /** The device. */
  uid: RdmUid;
  /** Fixture linked to the device (any link state), null when it is not on the canvas. */
  fixtureId: FixtureId | null;
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
  /** Show DMX address and personality editors (device dialog; the inspector uses the fixture fields). */
  patchEditable?: boolean;
  /** Show the status kind as a chip (the inspector shows its badge in the heading instead). */
  showKind?: boolean;
  /** Fold everything but the Mismatch actions into a collapsed “Details” block (inspector). */
  compact?: boolean;
}>(), { runtime: undefined, patchEditable: false, showKind: true, compact: false });

const emit = defineEmits<{
  /** “Add”: put the device on the canvas with its current address and mode (the parent runs it). */
  add: [];
}>();

/** PIDs this panel shows itself (or that are fixture fields): not in the generic form. */
const OWN_PIDS = [RDM_PID.DEVICE_LABEL, RDM_PID.IDENTIFY_DEVICE, RDM_PID.SOFTWARE_VERSION_LABEL, RDM_PID.DMX_START_ADDRESS, RDM_PID.DMX_PERSONALITY];

/** Classes of the small buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';
/** Classes of the primary small buttons (Add, Write to device). */
const PRIMARY = 'px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] disabled:opacity-50';

/** Chip text and classes per status (theme tokens only; same as the badge). */
const KIND_STYLE: Record<LinkStatusKind | 'new', { text: string; cls: string }> = {
  connected: { text: 'Connected', cls: 'bg-primary/15 text-primary' },
  mismatch: { text: 'Mismatch', cls: 'bg-destructive/15 text-destructive' },
  offline: { text: 'Offline', cls: 'bg-muted text-muted-foreground' },
  unlinked: { text: 'Unlinked', cls: 'border border-dashed border-border text-muted-foreground' },
  new: { text: 'Not on the canvas', cls: 'bg-primary/10 text-primary' },
};

const runtime = props.runtime ?? getDeviceRuntime();
const backend = runtime?.backend ?? getArtNetBackend();

/** The linked fixture (reactive through the model tick) and its link state. */
const view = computed(() => (props.fixtureId ? getFixture(props.fixtureId) : undefined));
const state = computed(() => (runtime && view.value ? fixtureLinkState(runtime, view.value) : null));
const device = computed(() => runtime?.store.get(props.uid));
const description = computed(() => device.value?.description ?? null);
/** The device can be talked to right now. */
const reachable = computed(() => backend.state.value.kind === 'connected' && !!device.value?.present && !device.value.noAnswer);

/** Status kind: the link's, else new/offline for a device without fixture. */
const kind = computed<LinkStatusKind | 'new'>(() => state.value?.status.kind ?? (device.value?.present ? 'new' : 'offline'));

/** One line: why it is not Connected, else what Connected means. */
const statusText = computed(() => {
  if (!runtime) return 'Device features are not active.';
  const s = state.value;
  if (s) return s.status.reasons.join(' · ') || 'Address and mode changes are sent to the device.';
  return device.value?.present ? 'Use Add to put it on the canvas with its current address and mode.' : 'Not on the canvas, and not in the last device list of its port.';
});

/** Node port (of the link, else where the device was last listed) with its universe. */
const portLine = computed(() => {
  const s = state.value;
  if (s) return portText(s.portName, s.portUniverse);
  return device.value ? devicePortText(device.value) : '—';
});
const firmware = computed(() => firmwareText(device.value));
const model = computed(() => description.value?.deviceModelDescription ?? null);
const manufacturer = computed(() => description.value?.manufacturerLabel ?? null);
/** Node of the device (link first: the inspector shows the link's node). */
const nodeId = computed(() => state.value?.link.nodeId ?? device.value?.nodeId ?? null);

/** RDM address of the device for the parameter form. */
const address = computed<RdmAddress | null>(() => (device.value ? { nodeId: device.value.nodeId, port: { ...device.value.port }, uid: device.value.uid } : null));

/**
 * Description handed to the form, replaced only when its parameters change:
 * a re-describe or a label write must not reset and re-read the form.
 */
const formDescription = shallowRef<RdmDeviceDescription | null>(null);
const parameterKey = (d: RdmDeviceDescription) => `${d.uid}|${d.deviceInfo.softwareVersionId}|${d.supportedParameters.join(',')}|${d.parameterDescriptions.map(p => p.pid).join(',')}`;
watch(description, (d) => {
  if (!d) formDescription.value = null;
  else if (!formDescription.value || parameterKey(formDescription.value) !== parameterKey(d)) formDescription.value = d;
}, { immediate: true });

const labelSupported = computed(() => !!description.value?.supportedParameters.includes(RDM_PID.DEVICE_LABEL));

/** Tube firmware updates only exist for our tubes (manufacturer + model, D17). */
const firmwareUpdatable = computed(() => {
  if (!nodeId.value || uidManufacturer(props.uid) !== PM_DEVICE.ESTA_MANUFACTURER) return false;
  const modelId = device.value?.info?.deviceModelId;
  return modelId === undefined || modelId === PM_DEVICE.MODEL_TUBE;
});
/** Tube readings from the device store (no extra GETs). */
const readTube = deviceStoreTubeReader(runtime?.store ?? null, backend);

const identify = useDeviceIdentify(runtime?.store ?? null, () => props.uid);
const { on: identifying, busy: identifyBusy, error: identifyError } = identify;

const canAdd = computed(() => canAddDevice(device.value, props.fixtureId));

// ── Mismatch, Unlink / Re-link ─────────────────

const linkBusy = ref(false);
const linkError = ref<string | null>(null);
watch(() => [props.fixtureId, props.uid], () => { linkError.value = null; });
/** Why Re-link is not possible, null when it is (only asked while not effective). */
const relinkBlocked = computed(() => (props.fixtureId && state.value && !state.value.effective ? relinkProblem(props.fixtureId) : null));

/** Runs a link action with its error shown inline. */
async function runLink(action: (runtime: DeviceRuntime, fixtureId: FixtureId) => unknown) {
  if (!runtime || !props.fixtureId) return;
  linkBusy.value = true;
  linkError.value = null;
  try {
    await action(runtime, props.fixtureId);
  }
  catch (err) {
    linkError.value = (err as Error).message ?? String(err);
  }
  finally {
    linkBusy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 text-xs" data-rdm-device-panel>
    <div v-if="state?.status.kind === 'mismatch'" class="flex flex-wrap gap-1.5" data-rdm-mismatch>
      <button type="button" :class="PRIMARY" :disabled="linkBusy" title="Send the fixture's mode and address to the device" data-write-device @click="runLink(writeToDevice)">
        Write to device
      </button>
      <button type="button" :class="BUTTON" :disabled="linkBusy" title="Set the fixture to the device's address and mode" data-take-device @click="runLink(takeFromDevice)">
        Take from device
      </button>
    </div>
    <!-- Native <details> in compact mode: folded content stays mounted and only hides. -->
    <component :is="compact ? 'details' : 'div'" class="group" data-rdm-details>
      <summary v-if="compact" class="flex cursor-pointer select-none list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span class="inline-block transition-transform group-open:rotate-90">›</span>
        Details
      </summary>
      <div class="flex flex-col gap-2" :class="{ 'pt-2': compact }">
        <div class="flex flex-col gap-1">
          <span v-if="showKind" class="w-fit rounded px-1 text-[10px] leading-4" :class="KIND_STYLE[kind].cls" data-rdm-kind>{{ KIND_STYLE[kind].text }}</span>
          <p class="text-[11px] text-muted-foreground" data-rdm-status>{{ statusText }}</p>
        </div>
        <dl class="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]">
          <dt class="text-muted-foreground">UID</dt>
          <dd class="truncate font-mono select-all" :title="uid" data-rdm-uid>{{ uid }}</dd>
          <dt class="text-muted-foreground">Port</dt>
          <dd class="truncate" :title="portLine" data-rdm-port>{{ portLine }}</dd>
          <dt class="text-muted-foreground">Model</dt>
          <dd class="truncate" :title="model ?? undefined" data-rdm-model>{{ model ?? '—' }}</dd>
          <dt class="text-muted-foreground">Maker</dt>
          <dd class="truncate" :title="manufacturer ?? undefined" data-rdm-manufacturer>{{ manufacturer ?? '—' }}</dd>
          <dt class="text-muted-foreground">Firmware</dt>
          <dd class="truncate" :title="firmware ?? undefined" data-rdm-firmware>{{ firmware ?? '—' }}</dd>
        </dl>
        <div class="flex min-h-7 items-center gap-2" data-rdm-identify>
          <span class="w-16 shrink-0 text-muted-foreground">Identify</span>
          <IdentifyButton :on="identifying" :disabled="!reachable || identifyBusy" @toggle="identify.set" />
        </div>
        <p v-if="identifyError" class="text-[10px] text-destructive">{{ identifyError }}</p>
        <RdmPatchFields v-if="runtime && patchEditable" :runtime="runtime" :uid="uid" :fixture-id="fixtureId" :follow="!!state?.effective" :disabled="!reachable" />
        <RdmDeviceLabelField v-if="runtime && labelSupported" :store="runtime.store" :uid="uid" :label="description?.deviceLabel ?? null" :disabled="!reachable" />
        <RdmParameterForm v-if="address && formDescription && device?.present" :address="address" :description="formDescription" :backend="backend" :exclude="OWN_PIDS" title="Parameters" />
        <p v-else-if="device?.loading" class="text-[11px] text-muted-foreground">Reading the device…</p>
        <div class="flex flex-wrap items-center gap-2">
          <TubeFirmwareButton v-if="firmwareUpdatable && nodeId" :node-id="nodeId" :uid="uid" :backend="backend" :read-tube="readTube" />
          <button
            v-if="canAdd"
            type="button"
            :class="['ml-auto', PRIMARY]"
            title="Add the device to the canvas with its current address and mode"
            data-add-device
            @click="emit('add')"
          >
            Add
          </button>
          <template v-if="state">
            <button
              v-if="state.effective"
              type="button"
              :class="['ml-auto', BUTTON]"
              title="Stop sending address and mode changes to the device (the UID is kept)"
              data-unlink
              @click="runLink(unlinkFixture)"
            >
              Unlink
            </button>
            <button
              v-else
              type="button"
              :class="['ml-auto', BUTTON]"
              :disabled="!!relinkBlocked"
              :title="relinkBlocked ?? 'Move the fixture back to its node port’s universe and send changes to the device again'"
              data-relink
              @click="runLink(relinkFixture)"
            >
              Re-link
            </button>
          </template>
        </div>
      </div>
    </component>
    <p v-if="linkError" class="text-[10px] text-destructive" data-rdm-link-error>{{ linkError }}</p>
  </div>
</template>
