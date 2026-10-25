<script setup lang="ts">
/**
 * “RDM” section of the fixture inspector (plan M7.2, D18), contributed to
 * `properties:after` for a single selected fixture with an RDM link:
 * status badge and text, UID, node port, firmware (SOFTWARE_VERSION_LABEL),
 * Identify (switched off when the selection changes or the section
 * closes), DEVICE_LABEL, the device's further parameters (generic form,
 * M7.1), “Update firmware…” (M7.4) and Unlink / Re-link (D14). Address and
 * mode stay the normal fixture fields.
 *
 * Holds `retainArtNetDiscovery()` while mounted, so the bridge connection
 * runs even when the Connectors page was never opened.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useReplaceable, useScope } from '@pixelmapper/extension-api';
import type { RdmAddress } from '../bridge/protocol-messages';
import type { RdmDeviceDescription } from '../bridge/protocol-model';
import { PM_DEVICE, RDM_PID } from '../bridge/rdm-constants';
import { getArtNetBackend, retainArtNetDiscovery } from '../bridge/shared';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { fixtureLinkState } from '../devices/fixture-link-state';
import { relinkFixture, relinkProblem, unlinkFixture } from '../devices/link-actions';
import { deviceStoreTubeReader, readingFromDevice } from '../firmware/device-store-reader';
import { formatFirmwareVersion, isFirmwareVersionId } from '../firmware/firmware-version';
import { uidManufacturer } from '../rdm/parameter-form/parameter-fields';
import RdmStatusBadge from '../components/RdmStatusBadge.vue';
import TubeFirmwareButton from '../firmware/TubeFirmwareButton.vue';
import RdmParameterForm from '../rdm/parameter-form/RdmParameterForm.vue';
import RdmDeviceLabelField from './RdmDeviceLabelField.vue';
import { useDeviceIdentify } from './use-device-identify';

const props = defineProps<{
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();

/** PIDs this section shows itself (or that are fixture fields): not in the generic form. */
const OWN_PIDS = [RDM_PID.DEVICE_LABEL, RDM_PID.IDENTIFY_DEVICE, RDM_PID.SOFTWARE_VERSION_LABEL, RDM_PID.DMX_START_ADDRESS, RDM_PID.DMX_PERSONALITY];

/** Classes of the small buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';

const fixture = useScope('fixture');
const runtime = props.runtime ?? getDeviceRuntime();
const backend = runtime?.backend ?? getArtNetBackend();
const Toggle = useReplaceable('pm.toggle');

// The bridge connection is needed while the section is open.
onBeforeUnmount(retainArtNetDiscovery());

/** Link, device, port universe and status of the inspected fixture. */
const state = computed(() => (runtime && fixture.value ? fixtureLinkState(runtime, fixture.value) : null));
const device = computed(() => state.value?.device);
const description = computed(() => device.value?.description ?? null);
/** The device can be talked to right now. */
const reachable = computed(() => backend.state.value.kind === 'connected' && !!device.value?.present && !device.value.noAnswer);

/** One line under the badge: why it is not Connected, else what Connected means. */
const statusText = computed(() => {
  const s = state.value;
  if (!s) return runtime ? '' : 'Device features are not active.';
  return s.status.reasons.join(' · ') || 'Address and mode changes are sent to the device.';
});

/** SOFTWARE_VERSION_LABEL of the running firmware, else its version id. */
const firmware = computed(() => {
  const d = device.value;
  if (!d?.info) return d?.description?.softwareVersionLabel ?? null;
  const reading = readingFromDevice(d.info, d.description);
  if (reading.state !== 'ok') return null;
  if (reading.softwareVersionLabel) return reading.softwareVersionLabel;
  return isFirmwareVersionId(d.info.softwareVersionId) ? formatFirmwareVersion(d.info.softwareVersionId) : `0x${d.info.softwareVersionId.toString(16)}`;
});

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
  const s = state.value;
  if (!s || uidManufacturer(s.link.uid) !== PM_DEVICE.ESTA_MANUFACTURER) return false;
  const model = device.value?.info?.deviceModelId;
  return model === undefined || model === PM_DEVICE.MODEL_TUBE;
});
/** Tube readings from the device store (no extra GETs). */
const readTube = deviceStoreTubeReader(runtime?.store ?? null, backend);

const identify = useDeviceIdentify(runtime?.store ?? null, () => state.value?.link.uid ?? null);
const { on: identifying, busy: identifyBusy, error: identifyError } = identify;

// ── Unlink / Re-link ───────────────────────────

const linkError = ref<string | null>(null);
watch(() => fixture.value?.id, () => { linkError.value = null; });
/** Why Re-link is not possible, null when it is (only asked while not effective). */
const relinkBlocked = computed(() => (fixture.value && state.value && !state.value.effective ? relinkProblem(fixture.value.id) : null));

function unlink() {
  if (runtime && fixture.value) unlinkFixture(runtime, fixture.value.id);
}

function relink() {
  if (!runtime || !fixture.value) return;
  linkError.value = null;
  try {
    relinkFixture(runtime, fixture.value.id);
  }
  catch (err) {
    linkError.value = (err as Error).message ?? String(err);
  }
}
</script>

<template>
  <section v-if="state" class="flex flex-col gap-2 text-xs" data-rdm-inspector>
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">RDM</span>
      <RdmStatusBadge :runtime="runtime" />
    </div>
    <p class="text-[11px] text-muted-foreground" data-rdm-status>{{ statusText }}</p>
    <dl class="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 text-[11px]">
      <dt class="text-muted-foreground">UID</dt>
      <dd class="font-mono select-all" data-rdm-uid>{{ state.link.uid }}</dd>
      <dt class="text-muted-foreground">Port</dt>
      <dd data-rdm-port>{{ state.portName }}<template v-if="state.portUniverse !== null"> · U{{ state.portUniverse }}</template></dd>
      <dt class="text-muted-foreground">Firmware</dt>
      <dd data-rdm-firmware>{{ firmware ?? '—' }}</dd>
    </dl>
    <div class="flex min-h-7 items-center gap-2" data-rdm-identify>
      <span class="w-16 shrink-0 text-muted-foreground">Identify</span>
      <component :is="Toggle" :model-value="identifying" :disabled="!reachable || identifyBusy" size="sm" @update:model-value="identify.set" />
    </div>
    <p v-if="identifyError" class="text-[10px] text-destructive">{{ identifyError }}</p>
    <RdmDeviceLabelField v-if="runtime && labelSupported" :store="runtime.store" :uid="state.link.uid" :label="description?.deviceLabel ?? null" :disabled="!reachable" />
    <RdmParameterForm v-if="address && formDescription && device?.present" :address="address" :description="formDescription" :backend="backend" :exclude="OWN_PIDS" title="Parameters" />
    <p v-else-if="device?.loading" class="text-[11px] text-muted-foreground">Reading the device…</p>
    <div class="flex flex-wrap items-center gap-2">
      <TubeFirmwareButton v-if="firmwareUpdatable" :node-id="state.link.nodeId" :uid="state.link.uid" :backend="backend" :read-tube="readTube" />
      <button
        v-if="state.effective"
        type="button"
        :class="['ml-auto', BUTTON]"
        title="Stop sending address and mode changes to the device (the UID is kept)"
        data-unlink
        @click="unlink"
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
        @click="relink"
      >
        Re-link
      </button>
    </div>
    <p v-if="linkError" class="text-[10px] text-destructive">{{ linkError }}</p>
  </section>
</template>
