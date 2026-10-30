<script setup lang="ts">
/**
 * Collapsible block of the Art-Net connector card (WP13): the node-level
 * sections (Failsafe, Network, Device, Advanced), each port, and the
 * Advanced part inside a port. Open state comes from the card's collapse
 * store (remembered per connector). The content is mounted only while
 * open, so a closed block sends no requests and closing a block ends what
 * it started (e.g. identify).
 *
 * The header is a toggle button plus, outside the button (no nested
 * buttons), an optional ⓘ tip and the `summary` slot / `hint` text.
 */
import { computed, useId } from 'vue';
import type { InfoTopic } from './info-texts';
import { useCardCollapse } from './use-card-collapse';
import InfoTip from './InfoTip.vue';

const props = withDefaults(defineProps<{
  /** Key of the block in the collapse store (e.g. `port:1.0`, `network`). */
  sectionId: string;
  /** Heading. */
  title: string;
  /** Short text right of the heading (e.g. the node's IP). */
  hint?: string;
  /** Term explained by an ⓘ next to the heading. */
  info?: InfoTopic;
  /** Open until the user toggles it. */
  defaultOpen?: boolean;
  /** `section`: plain heading; `block`: a list item with a divider above (ports — flat, no box in the card); `sub`: small heading inside a block. */
  variant?: 'section' | 'block' | 'sub';
}>(), { hint: undefined, info: undefined, defaultOpen: false, variant: 'section' });

const collapse = useCardCollapse();
const open = computed(() => collapse.isOpen(props.sectionId, props.defaultOpen));

/** Element id of the content (for `aria-controls`; stable across server and client render). */
const contentId = `artnet-card-${useId()}`;

/** Classes per variant. */
const ROOT = { section: 'flex flex-col', block: 'flex flex-col border-t border-border/50', sub: 'flex flex-col' } as const;
const HEADER = {
  section: 'flex min-h-7 items-center gap-1 text-xs font-medium text-foreground',
  block: 'flex min-h-8 items-center gap-1 text-xs',
  sub: 'flex min-h-6 items-center gap-1 text-[11px] text-muted-foreground',
} as const;
const BODY = { section: 'pb-2 pl-4', block: 'pb-2 pl-4', sub: 'pb-1 pl-4' } as const;
</script>

<template>
  <section :class="ROOT[variant]" :data-section="sectionId">
    <div :class="HEADER[variant]">
      <button
        type="button"
        class="flex min-w-0 items-center gap-1 py-1 text-left hover:text-foreground/80"
        :aria-expanded="open"
        :aria-controls="contentId"
        data-section-toggle
        @click="collapse.setOpen(sectionId, !open)"
      >
        <svg viewBox="0 0 16 16" class="size-3 shrink-0 transition-transform" :class="open && 'rotate-90'" aria-hidden="true">
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="truncate" :class="variant === 'block' && 'font-medium'">{{ title }}</span>
      </button>
      <InfoTip v-if="info" :topic="info" />
      <slot name="summary">
        <span v-if="hint" class="ml-auto truncate pl-2 text-[10px] font-normal text-muted-foreground">{{ hint }}</span>
      </slot>
    </div>
    <div v-if="open" :id="contentId" :class="BODY[variant]">
      <slot />
    </div>
  </section>
</template>
