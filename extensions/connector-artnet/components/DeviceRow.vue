<script setup lang="ts">
/**
 * One RDM device in the node's device list (plan M6.1): address · label ·
 * model · personality · firmware · state, and its actions Identify, Add,
 * Assign free address. Emits the actions; the list runs them.
 */
import { computed } from 'vue';
import type { DeviceRow } from '../devices/use-device-list';

const props = defineProps<{
  row: DeviceRow;
  /** An action of this row is running. */
  busy: boolean;
  /** Result or error of the last action on this device. */
  message: { text: string; error: boolean } | null;
}>();
const emit = defineEmits<{ identify: [on: boolean]; add: []; assign: [] }>();

/** Badge text and classes per state (theme tokens only). */
const STATE_STYLE: Record<DeviceRow['state'], { text: string; cls: string }> = {
  new: { text: 'new', cls: 'bg-primary/10 text-primary' },
  linked: { text: 'linked', cls: 'bg-muted text-foreground' },
  conflict: { text: 'conflict', cls: 'bg-destructive/15 text-destructive' },
  offline: { text: 'offline', cls: 'bg-muted text-muted-foreground' },
};

const state = computed(() => STATE_STYLE[props.row.state]);

/** Tooltip of the state badge. */
const stateTitle = computed(() => {
  const r = props.row;
  if (r.state === 'conflict') return `Overlaps ${r.conflicts.join(', ')}`;
  if (r.state === 'offline') return 'Not in the last device list of the port';
  if (r.state === 'linked') return 'On the canvas as a fixture';
  return 'Not on the canvas yet';
});

/** Last action message, else the device's last read/write error. */
const note = computed(() => props.message ?? (props.row.entry.error ? { text: props.row.entry.error, error: true } : null));
</script>

<template>
  <div class="flex flex-col gap-0.5 py-1 border-b border-border/50 last:border-b-0" :class="row.state === 'offline' ? 'opacity-60' : ''">
    <div class="flex items-center gap-2 text-xs min-w-0">
      <span class="w-14 shrink-0 font-mono text-[11px]" :title="`${row.portLabel}, DMX start address`">{{ row.address }}</span>
      <span class="flex-1 min-w-0 truncate" :title="`${row.label} · UID ${row.uid}`">
        <span class="font-medium">{{ row.label }}</span>
        <span v-if="row.label !== row.model" class="text-muted-foreground"> · {{ row.model }}</span>
      </span>
      <span class="shrink-0 px-1 rounded text-[10px]" :class="state.cls" :title="stateTitle">{{ state.text }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-16 text-[10px] text-muted-foreground">
      <span :title="'Personality'">{{ row.personality }}</span>
      <span :title="'Firmware'">FW {{ row.firmware }}</span>
      <span v-if="row.entry.loading">reading…</span>
      <span class="ml-auto flex items-center gap-1">
        <button
          class="px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
          :class="row.entry.identifying ? 'bg-primary/15 text-primary border-primary/40' : ''"
          :disabled="busy || !row.entry.present"
          :title="row.entry.identifying ? 'Stop identifying' : 'Let the device flash'"
          @click="emit('identify', !row.entry.identifying)"
        >
          Identify
        </button>
        <button
          v-if="row.canAdd"
          class="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          :disabled="busy"
          title="Add the device to the canvas with its current address and mode"
          @click="emit('add')"
        >
          Add
        </button>
        <button
          v-if="row.canAssign && row.state === 'conflict'"
          class="px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="busy"
          title="Move the device to the first free address of its universe"
          @click="emit('assign')"
        >
          Assign free address
        </button>
      </span>
    </div>
    <p v-if="note" class="pl-16 text-[10px]" :class="note.error ? 'text-destructive' : 'text-muted-foreground'">{{ note.text }}</p>
  </div>
</template>
