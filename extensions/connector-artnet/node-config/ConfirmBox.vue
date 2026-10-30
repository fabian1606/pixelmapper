<script setup lang="ts">
/**
 * Inline confirmation of a risky node change (plan D8: network changes,
 * direction changes while data flows, recording the failsafe scene) — like
 * the confirmation on the node's own display. Rendered in place instead of
 * as a floating dialog: extensions have no dialog API, and an in-place box
 * cannot be mistaken for an outside click by the surrounding sidebar.
 */
withDefaults(defineProps<{
  /** What will happen. */
  message: string;
  /** Further consequence (e.g. connections drop), shown below. */
  detail?: string;
  /** Label of the confirming button. */
  confirmLabel?: string;
  /** The confirmed command is running: buttons are locked. */
  busy?: boolean;
}>(), { detail: undefined, confirmLabel: 'Confirm', busy: false });

const emit = defineEmits<{ confirm: []; cancel: [] }>();

/** Classes of the buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';
</script>

<template>
  <div role="alertdialog" :aria-label="message" class="flex flex-col gap-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px]" data-confirm>
    <p class="text-foreground">{{ message }}</p>
    <p v-if="detail" class="text-muted-foreground">{{ detail }}</p>
    <div class="flex justify-end gap-1">
      <button type="button" :class="BUTTON" :disabled="busy" data-confirm-cancel @click="emit('cancel')">Cancel</button>
      <button type="button" :class="[BUTTON, 'text-destructive']" :disabled="busy" data-confirm-ok @click="emit('confirm')">
        {{ busy ? 'Working…' : confirmLabel }}
      </button>
    </div>
  </div>
</template>
