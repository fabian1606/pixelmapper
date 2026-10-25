<script setup lang="ts">
/**
 * Collapsible section of the node configuration panel (plan D8: Ports,
 * Network, Device, Advanced). The content is mounted only while open, so a
 * closed section sends no requests, and closing a section ends what it
 * started (e.g. identify).
 */
import { useId } from 'vue';

withDefaults(defineProps<{
  /** Heading. */
  title: string;
  /** Short text right of the heading (e.g. the node's IP). */
  hint?: string;
}>(), { hint: undefined });

/** Open state (`v-model:open`; closed by default). */
const open = defineModel<boolean>('open', { default: false });

/** Element id of the content (for `aria-controls`; stable across server and client render). */
const contentId = `node-config-${useId()}`;
</script>

<template>
  <section class="flex flex-col" :data-section="title">
    <button
      type="button"
      class="flex w-full items-center gap-1 py-1 text-xs font-medium text-foreground hover:text-foreground/80"
      :aria-expanded="open"
      :aria-controls="contentId"
      @click="open = !open"
    >
      <svg viewBox="0 0 16 16" class="size-3 shrink-0 transition-transform" :class="open && 'rotate-90'" aria-hidden="true">
        <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {{ title }}
      <span v-if="hint" class="ml-auto truncate pl-2 text-[10px] font-normal text-muted-foreground">{{ hint }}</span>
    </button>
    <div v-if="open" :id="contentId" class="pb-2 pl-4">
      <slot />
    </div>
  </section>
</template>
