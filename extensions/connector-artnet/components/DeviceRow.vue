<script setup lang="ts">
/**
 * One RDM device in a port's device list (plan M6.1, WP13): address ·
 * label · model · state, personality and firmware, and its quick actions
 * Identify (flashlight), Add, Assign free address. The whole row is
 * clickable (and keyboard-operable) and opens the device dialog with all
 * of the device's settings. Emits the actions; the card runs them.
 */
import { computed } from 'vue';
import type { DeviceRow } from '../devices/use-device-list';
import IdentifyButton from '../inspector/IdentifyButton.vue';

const props = defineProps<{
  row: DeviceRow;
  /** An action of this row is running. */
  busy: boolean;
  /** Result or error of the last action on this device. */
  message: { text: string; error: boolean } | null;
}>();
const emit = defineEmits<{ identify: [on: boolean]; add: []; assign: []; open: [] }>();

/** Badge text and classes per state (theme tokens only). */
const STATE_STYLE: Record<DeviceRow['state'], { text: string; cls: string }> = {
  new: { text: 'new', cls: 'bg-primary/10 text-primary' },
  linked: { text: 'linked', cls: 'bg-muted text-foreground' },
  mismatch: { text: 'mismatch', cls: 'bg-destructive/15 text-destructive' },
  unlinked: { text: 'unlinked', cls: 'border border-dashed border-border text-muted-foreground' },
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
  if (r.state === 'mismatch') return 'The device reports another address or mode than its fixture';
  if (r.state === 'unlinked') return 'The fixture was moved out of the port\'s universe: changes are not sent';
  return 'Not on the canvas yet';
});

/** Last action message, else the device's last read/write error. */
const note = computed(() => props.message ?? (props.row.entry.error ? { text: props.row.entry.error, error: true } : null));

/** Classes of the small buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50';
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="flex cursor-pointer flex-col gap-0.5 rounded px-1 py-1 -mx-1 hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    :class="row.state === 'offline' ? 'opacity-60' : ''"
    :title="`${row.label} · UID ${row.uid} — click for all settings`"
    :data-device="row.uid"
    @click="emit('open')"
    @keydown.enter.self.prevent="emit('open')"
    @keydown.space.self.prevent="emit('open')"
  >
    <div class="flex items-center gap-2 text-xs min-w-0">
      <span class="w-12 shrink-0 font-mono text-[11px]" :title="`${row.portLabel}, DMX start address`">{{ row.address }}</span>
      <span class="flex-1 min-w-0 truncate">
        <span class="font-medium">{{ row.label }}</span>
        <span v-if="row.label !== row.model" class="text-muted-foreground"> · {{ row.model }}</span>
      </span>
      <span class="shrink-0 px-1 rounded text-[10px]" :class="state.cls" :title="stateTitle" data-device-state>{{ state.text }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-14 text-[10px] text-muted-foreground">
      <span title="Personality (mode)">{{ row.personality }}</span>
      <span title="Firmware">FW {{ row.firmware }}</span>
      <span v-if="row.entry.loading">reading…</span>
      <span class="ml-auto flex items-center gap-1 text-[11px]">
        <IdentifyButton small :on="row.entry.identifying" :disabled="busy || !row.entry.present" @toggle="emit('identify', $event)" />
        <button
          v-if="row.canAdd"
          type="button"
          :class="[BUTTON, 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20']"
          :disabled="busy"
          title="Add the device to the canvas with its current address and mode"
          data-add
          @click.stop="emit('add')"
        >
          Add
        </button>
        <button
          v-if="row.canAssign && row.state === 'conflict'"
          type="button"
          :class="[BUTTON, 'border-border hover:bg-accent']"
          :disabled="busy"
          title="Move the device to the first free address of its universe"
          data-assign
          @click.stop="emit('assign')"
        >
          Assign free address
        </button>
      </span>
    </div>
    <p v-if="note" class="pl-14 text-[10px]" :class="note.error ? 'text-destructive' : 'text-muted-foreground'">{{ note.text }}</p>
  </div>
</template>
