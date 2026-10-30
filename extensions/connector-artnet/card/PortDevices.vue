<script setup lang="ts">
/**
 * “Devices on this port” inside a port block (WP13; plan M6.1, D9): the RDM
 * devices of one node port with their state and quick actions, “Add all on
 * this port” (one undo step) and “Rediscover” (ArtTodControl flush of this
 * port). A click on a row opens the device dialog. Without devices it
 * explains that fixtures without RDM still receive DMX; a port that
 * answered TodNak says that RDM is not available there.
 */
import { computed } from 'vue';
import type { PortRef, RdmUid } from '../bridge/protocol-model';
import type { DeviceActions } from '../devices/use-device-actions';
import type { DeviceRow as DeviceRowData } from '../devices/use-device-list';
import DeviceRow from '../components/DeviceRow.vue';
import InfoTip from './InfoTip.vue';

const props = defineProps<{
  /** Devices of this port. */
  rows: DeviceRowData[];
  port: PortRef;
  /** `1.0`: scope of this port's summary line. */
  portKey: string;
  /** The port answered TodNak (no RDM there). */
  noRdm: boolean;
  /** The node answers (Rediscover needs it). */
  online: boolean;
  actions: DeviceActions;
}>();
const emit = defineEmits<{ open: [uid: RdmUid] }>();

/** New devices that “Add all on this port” would add. */
const addable = computed(() => props.rows.filter(r => r.canAdd));
/** Summary of the last action on this port. */
const summary = computed(() => (props.actions.summary.value?.scope === props.portKey ? props.actions.summary.value : null));

/** Classes of the small buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50';
</script>

<template>
  <div class="flex flex-col gap-0.5" data-port-devices>
    <div class="flex min-h-7 flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span>Devices on this port</span>
      <InfoTip topic="deviceStates" />
      <span class="ml-auto flex items-center gap-1">
        <button
          v-if="addable.length"
          type="button"
          :class="[BUTTON, 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20']"
          :disabled="actions.nodeBusy.value"
          :title="`Add ${addable.length} devices with their current address and mode (one undo step)`"
          data-add-port
          @click="actions.add(addable.map(r => r.uid), portKey)"
        >
          Add all on this port
        </button>
        <button
          type="button"
          :class="[BUTTON, 'border-border text-foreground hover:bg-accent']"
          :disabled="actions.nodeBusy.value || !online"
          title="Clear this port's device list and search again"
          data-rediscover
          @click="actions.rediscover([port], portKey)"
        >
          Rediscover
        </button>
        <InfoTip topic="rediscover" />
      </span>
    </div>
    <p v-if="noRdm" class="text-[11px] text-muted-foreground" data-no-rdm>RDM is not available on this port (off, input, or RDM disabled).</p>
    <p v-else-if="!rows.length" class="text-[11px] text-muted-foreground" data-no-devices>
      No RDM devices found on this port. Connected fixtures without RDM still receive DMX.
    </p>
    <DeviceRow
      v-for="row in rows"
      :key="row.uid"
      :row="row"
      :busy="actions.busy.has(row.uid)"
      :message="actions.messages.get(row.uid) ?? null"
      @identify="actions.identify(row.uid, $event)"
      @add="actions.add([row.uid], portKey)"
      @assign="actions.assign(row.uid)"
      @open="emit('open', row.uid)"
    />
    <p v-if="summary" class="text-[11px]" :class="summary.error ? 'text-destructive' : 'text-muted-foreground'">{{ summary.text }}</p>
  </div>
</template>
