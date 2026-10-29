<script setup lang="ts">
/**
 * “Add by IP” field (plan M5.2 manual add): for devices the broadcast poll
 * does not reach or that never answer ArtPoll (then a manual target, DMX
 * unicast to that IP). Emits the IP; the bridge then polls it directly.
 * Broadcast addresses are refused: Art-Net 4 sends ArtDmx unicast only.
 */
import { computed, ref } from 'vue';

const emit = defineEmits<{ add: [ip: string] }>();

const ip = ref('');

/** Dotted-quad IPv4 check; the unspecified and limited broadcast addresses are no device. */
const valid = computed(() => {
  const value = ip.value.trim();
  const parts = value.split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    && value !== '0.0.0.0' && value !== '255.255.255.255';
});

function submit() {
  if (!valid.value) return;
  emit('add', ip.value.trim());
  ip.value = '';
}
</script>

<template>
  <form class="flex items-center gap-1.5" @submit.prevent="submit">
    <input
      v-model="ip"
      type="text"
      inputmode="decimal"
      placeholder="Device IP, e.g. 2.27.44.61"
      class="flex-1 min-w-0 rounded border border-border bg-background text-xs font-mono px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
    >
    <button
      type="submit"
      class="shrink-0 px-2 py-1 rounded text-xs border border-border hover:bg-accent transition-colors disabled:opacity-50"
      :disabled="!valid"
    >
      Add by IP
    </button>
  </form>
</template>
