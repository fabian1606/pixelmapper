<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useLiveBusStore, type CursorState } from '~/stores/live-bus-store';

const props = defineProps<{
  pageId: string;
  scale: number;
}>();

const liveBus = useLiveBusStore();
const { cursors } = storeToRefs(liveBus);

// Only show cursors that are on THIS live page
const cursorList = computed(() =>
  Array.from(cursors.value.values()).filter(
    c => c.context === 'live' && c.livePageId === props.pageId,
  ),
);

function cursorTransform(c: CursorState): string {
  // wx/wy are in canvas-local pixels. The parent canvas has transform: scale(s).
  // Translate to (wx,wy) in local space (so position is correct after parent scale),
  // then apply scale(1/s) to cancel the size scaling — cursor stays a constant
  // visual size regardless of canvas zoom/resolution.
  const inv = props.scale > 0 ? 1 / props.scale : 1;
  return `translate3d(${c.wx}px, ${c.wy}px, 0) scale(${inv})`;
}
</script>

<template>
  <!-- High z-index ensures the cursor overlay always sits above any widget,
       even pressed buttons that might create their own stacking context. -->
  <div class="absolute inset-0 pointer-events-none" style="z-index: 9999;">
    <div
      v-for="cursor in cursorList"
      :key="cursor.sessionId"
      class="absolute top-0 left-0 will-change-transform"
      style="transform-origin: 0 0;"
      :style="{ transform: cursorTransform(cursor) }"
    >
      <svg
        width="20"
        height="22"
        viewBox="0 0 20 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style="display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"
      >
        <path
          d="M2 2L2 18L6.5 14L9 20L12 19L9.5 13L15 13L2 2Z"
          :fill="cursor.color"
          stroke="white"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
      </svg>
      <span
        class="absolute text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
        :style="{
          backgroundColor: cursor.color,
          color: '#fff',
          left: '14px',
          top: '14px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }"
      >{{ cursor.displayName || cursor.userId.slice(0, 8) }}</span>
    </div>
  </div>
</template>
