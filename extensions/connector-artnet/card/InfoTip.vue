<script setup lang="ts">
/**
 * ⓘ next to a technical term of the Art-Net card (WP13): hover or focus
 * shows the explanation from `INFO_TEXTS`, a click pins it open, Escape or
 * a click outside closes it. The bubble is teleported to `<body>` with
 * `data-overlay-root` (listed in the core's `FLOATING_OVERLAY_SELECTORS`),
 * so clicking it does not close the sidebar the card sits in.
 *
 * Usage: `<InfoTip topic="portAddress" />`
 */
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { INFO_TEXTS, type InfoTopic } from './info-texts';

const props = defineProps<{ topic: InfoTopic }>();

/** Width of the bubble in px (matches `w-60`). */
const BUBBLE_WIDTH = 240;
/** Distance to the viewport edge in px. */
const EDGE = 8;

const info = computed(() => INFO_TEXTS[props.topic]);
const bubbleId = `artnet-info-${useId()}`;
const button = ref<HTMLButtonElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
/** Shown because of hover/focus. */
const hovered = ref(false);
/** Pinned open by a click. */
const pinned = ref(false);
const open = computed(() => hovered.value || pinned.value);
/** Fixed position of the bubble (viewport coordinates). */
const position = ref({ left: 0, top: 0 });

/** Places the bubble under the icon (above it when there is no room), inside the viewport. */
function place() {
  const rect = button.value?.getBoundingClientRect();
  if (!rect) return;
  const width = window.innerWidth || BUBBLE_WIDTH + 2 * EDGE;
  const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - BUBBLE_WIDTH / 2), Math.max(EDGE, width - BUBBLE_WIDTH - EDGE));
  const below = rect.bottom + 4;
  const roomBelow = (window.innerHeight || 0) - below;
  position.value = { left, top: roomBelow < 120 && rect.top > 140 ? Math.max(EDGE, rect.top - 4 - 120) : below };
}

/** Closes on a pointer-down outside the icon and the bubble. */
function onPointerDown(e: PointerEvent) {
  const target = e.target instanceof Node ? e.target : null;
  if (target && (button.value?.contains(target) || bubble.value?.contains(target))) return;
  pinned.value = false;
  hovered.value = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  pinned.value = false;
  hovered.value = false;
}

// Listen for outside clicks / Escape only while open.
watch(open, (now) => {
  if (now) {
    place();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
  }
  else {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKey);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <button
    ref="button"
    type="button"
    class="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    :aria-label="`About ${info.title}`"
    :aria-expanded="open"
    :aria-describedby="open ? bubbleId : undefined"
    :data-info-tip="topic"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focus="hovered = true"
    @blur="hovered = false"
    @click.stop.prevent="pinned = !pinned"
  >
    <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M8 7.2v3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="bubbleId"
      ref="bubble"
      data-overlay-root
      role="tooltip"
      class="fixed z-[160] w-60 rounded-md border border-border bg-popover p-2 text-[11px] leading-snug text-popover-foreground shadow-md"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      :data-info-bubble="topic"
      @click.stop
    >
      <p class="mb-0.5 font-medium">{{ info.title }}</p>
      <p class="text-muted-foreground">{{ info.text }}</p>
    </div>
  </Teleport>
</template>
