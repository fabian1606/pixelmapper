<script setup lang="ts">
/**
 * Flashlight toggle of RDM Identify (inspector RDM section and device
 * dialog). Shows the device's acknowledged state (`on`, D5) as
 * `aria-pressed` and a highlight; a click asks for the opposite state.
 *
 * Usage: `<IdentifyButton :on="identifying" :disabled="busy" @toggle="identify.set" />`
 */
defineProps<{
  /** The device acknowledged Identify on. */
  on: boolean;
  disabled?: boolean;
  /** Smaller button for list rows. */
  small?: boolean;
}>();
const emit = defineEmits<{
  /** The wanted state (the opposite of `on`). */
  toggle: [on: boolean];
}>();
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-50"
    :class="[small ? 'size-5' : 'size-7', on ? 'bg-primary/15 text-primary border-primary/40' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground']"
    title="Identify"
    :aria-pressed="on ? 'true' : 'false'"
    :disabled="disabled"
    data-identify-button
    @click.stop="emit('toggle', !on)"
  >
    <!-- "flashlight" icon -->
    <svg :class="small ? 'size-3' : 'size-4'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z" />
      <path d="M6 6h12M12 12h.01" />
    </svg>
  </button>
</template>
