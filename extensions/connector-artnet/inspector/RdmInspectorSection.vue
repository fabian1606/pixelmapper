<script setup lang="ts">
/**
 * “RDM” section of the fixture inspector (plan M7.2, D18), contributed to
 * `selection:after` (left sidebar, below the fixture's address and mode
 * fields) for a single selected fixture with an RDM link. Heading and status
 * badge in one row like the other inspector sections; the body is the
 * shared `RdmDevicePanel` (status text, UID, port, firmware, Identify,
 * DEVICE_LABEL, parameters, “Update firmware…”, Unlink / Re-link) without
 * its patch editors — address and mode stay the normal fixture fields.
 *
 * Holds `retainArtNetDiscovery()` while mounted, so the bridge connection
 * runs even when the Connectors page was never opened.
 */
import { computed, onBeforeUnmount } from 'vue';
import { useScope } from '@pixelmapper/extension-api';
import { retainArtNetDiscovery } from '../bridge/shared';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { fixtureLinkState } from '../devices/fixture-link-state';
import RdmStatusBadge from '../components/RdmStatusBadge.vue';
import RdmDevicePanel from './RdmDevicePanel.vue';

const props = defineProps<{
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();

const fixture = useScope('fixture');
const runtime = props.runtime ?? getDeviceRuntime();

// The bridge connection is needed while the section is open.
onBeforeUnmount(retainArtNetDiscovery());

/** Link of the inspected fixture (null: no runtime or no link → no section). */
const state = computed(() => (runtime && fixture.value ? fixtureLinkState(runtime, fixture.value) : null));
</script>

<template>
  <section v-if="state && fixture" class="flex flex-col gap-2 text-xs" data-rdm-inspector>
    <!-- Heading row in the style of the sidebar's other sections (cf. “DMX Settings”). -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">RDM</span>
      <RdmStatusBadge :runtime="runtime" />
    </div>
    <RdmDevicePanel :uid="state.link.uid" :fixture-id="fixture.id" :runtime="runtime" :patch-editable="false" :show-kind="false" />
  </section>
</template>
