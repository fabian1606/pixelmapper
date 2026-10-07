<script setup lang="ts">
/**
 * Tiny badge showing the slot id it is rendered in. Hover shows the
 * available scopes.
 */
import { computed } from 'vue';
import { useExtensionContext } from '@pixelmapper/extension-api';

const ctx = useExtensionContext();

/** Names of the scopes visible here (with a value). */
const scopeNames = computed(() =>
  Object.entries(ctx.scopes)
    .filter(([, ref]) => ref?.value !== undefined)
    .map(([name]) => name)
    .join(', '),
);
</script>

<template>
  <span
    class="inline-flex items-center rounded px-1 py-px font-mono text-[9px] leading-none bg-primary/20 text-primary whitespace-nowrap"
    :title="`scopes: ${scopeNames}`"
  >{{ ctx.slotId }}</span>
</template>
