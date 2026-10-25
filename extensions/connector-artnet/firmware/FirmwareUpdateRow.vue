<script setup lang="ts">
/**
 * One tube in the firmware update dialog: checkbox, UID and port, version
 * old → new, eligibility (greyed with the reason when not offered) and —
 * once queued — progress bar, phase and error of its update.
 */
import { computed } from 'vue';
import { formatFirmwareVersion } from './firmware-version';
import { describeFlashPhase, flashProgressFraction } from './flash-progress';
import type { FirmwareCandidate } from './use-firmware-update';

const props = defineProps<{
  candidate: FirmwareCandidate;
  /** Disables the checkbox (e.g. while asking for downgrade confirmation). */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** The checkbox changed. */
  select: [on: boolean];
  /** Cancel this tube's update. */
  cancel: [];
}>();

const c = computed(() => props.candidate);
const item = computed(() => c.value.item);

/** Not offered for the chosen image (greyed). */
const unavailable = computed(() => !c.value.present || (!!c.value.eligibility && !c.value.eligibility.selectable));

/** Tone of the eligibility badge (theme tokens only). */
const badgeClass = computed(() => {
  switch (c.value.eligibility?.kind) {
    case 'update':
    case 'bootloader':
      return 'border-primary/40 text-primary';
    case 'downgrade':
      return 'border-destructive/50 text-destructive';
    default:
      return 'border-border text-muted-foreground';
  }
});

/** Status line of the update, or null without one. */
const statusText = computed(() => {
  const i = item.value;
  if (!i) return null;
  const stuck = i.job?.inBootloader ? ' — the tube waits in its bootloader; update it again' : '';
  switch (i.status) {
    case 'queued':
      return 'Waiting for the port';
    case 'starting':
      return 'Checking the device…';
    case 'running':
      return i.job ? describeFlashPhase(i.job) : 'Running';
    case 'cancelling':
      return 'Cancelling…';
    case 'done': {
      const result = i.job?.result;
      return `Updated to ${result ? formatFirmwareVersion(result.softwareVersionId) : i.image?.version ?? 'the new version'}`;
    }
    case 'failed':
      return `${i.error ?? 'The update failed'}${stuck}`;
    case 'cancelled':
      return `Cancelled${stuck}`;
    default:
      return null;
  }
});

/** Progress 0–100 while the update is running, else null. */
const percent = computed(() => {
  const i = item.value;
  if (!i?.job || !(i.status === 'running' || i.status === 'cancelling')) return null;
  return Math.round(flashProgressFraction(i.job) * 100);
});
</script>

<template>
  <li
    class="flex flex-col gap-1 px-2 py-1.5 text-xs"
    :class="unavailable ? 'opacity-60' : ''"
    :data-uid="c.uid"
    :data-status="item?.status ?? 'none'"
  >
    <div class="flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-primary shrink-0"
        :checked="c.selected"
        :disabled="disabled || !c.selectable"
        :aria-label="`Update ${c.uid}`"
        @change="emit('select', ($event.target as HTMLInputElement).checked)"
      >
      <span class="font-mono text-[11px]">{{ c.uid }}</span>
      <span v-if="c.portLabel" class="text-muted-foreground">{{ c.portLabel }}</span>
      <span class="ml-auto tabular-nums" :title="c.currentLabel ?? undefined" data-versions>
        <template v-if="c.reading.state === 'loading' && c.present">Reading…</template>
        <template v-else>{{ c.currentVersion ?? '?' }}</template>
        <template v-if="c.targetVersion"> → {{ c.targetVersion }}</template>
      </span>
      <span
        v-if="c.eligibility && !c.pending"
        class="shrink-0 rounded border px-1 text-[10px] leading-4"
        :class="badgeClass"
        data-eligibility
      >{{ c.eligibility.label }}</span>
    </div>
    <p v-if="!c.present" class="pl-5 text-[11px] text-muted-foreground">
      Not in the node's device list — offline or on another node
    </p>
    <p v-else-if="c.eligibility?.reason && !item" class="pl-5 text-[11px] text-muted-foreground" data-reason>
      {{ c.eligibility.reason }}
    </p>
    <div v-if="item" class="flex items-center gap-2 pl-5">
      <div
        v-if="percent !== null"
        class="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="h-full bg-primary transition-[width]" :style="{ width: `${percent}%` }" />
      </div>
      <span
        class="min-w-0 flex-1 truncate text-[11px]"
        :class="item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
        :title="item.errorDetail ?? statusText ?? undefined"
        data-progress
      >{{ statusText }}<template v-if="percent !== null"> · {{ percent }} %</template></span>
      <button
        v-if="c.pending && item.status !== 'cancelling'"
        type="button"
        class="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </li>
</template>
