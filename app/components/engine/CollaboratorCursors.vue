<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useLiveBusStore, type CursorState } from '~/stores/live-bus-store';

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface Props {
  camera: Camera;
}

const props = defineProps<Props>();

const liveBus = useLiveBusStore();
const { cursors } = storeToRefs(liveBus);

const cursorList = computed(() => Array.from(cursors.value.values()));

function cursorTransform(c: CursorState): string {
  const vx = c.wx * props.camera.scale + props.camera.x;
  const vy = c.wy * props.camera.scale + props.camera.y;
  return `translate3d(${vx}px, ${vy}px, 0)`;
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none overflow-hidden" style="z-index: 50;">
    <!-- Remote cursors -->
    <div
      v-for="cursor in cursorList"
      :key="cursor.sessionId"
      class="absolute top-0 left-0 will-change-transform"
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
