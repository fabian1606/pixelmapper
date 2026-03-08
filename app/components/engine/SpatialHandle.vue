<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  /** 'origin' = square-style anchor (reposition center), 'endpoint' = circle (direction + magnitude) */
  type?: 'origin' | 'endpoint';
  x?: number;
  y?: number;
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
}

const props = withDefaults(defineProps<Props>(), { type: 'endpoint' });
const emit = defineEmits<Emits>();

const transformStyle = computed(() => {
  if (props.x === undefined || props.y === undefined) return {};
  const base = `translate3d(${props.x}px, ${props.y}px, 0) translate(-50%, -50%)`;
  return { transform: props.type === 'origin' ? `${base} rotate(45deg)` : base };
});
</script>

<template>
  <div
    class="spatial-handle"
    :class="[`spatial-handle--${type}`]"
    :style="transformStyle"
    @mousedown.prevent.stop="emit('dragstart', $event)"
  />
</template>

<style scoped>
.spatial-handle {
  position: absolute;
  top: 0;
  left: 0;
  cursor: grab;
  z-index: 20;
  transition: box-shadow 0.1s;
}

/* ── Endpoint handle: circle ──────────────────────────────────────────── */
.spatial-handle--endpoint {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  border: 2px solid var(--primary);
  box-shadow: 0 0 10px var(--primary);
  cursor: grab;
}

.spatial-handle--endpoint:hover {
  background: var(--primary);
  box-shadow: 0 0 18px var(--primary);
}

/* ── Origin handle: diamond / square rotated 45° ─────────────────────── */
.spatial-handle--origin {
  width: 15px;
  height: 15px;
  background: var(--primary);
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 8px var(--primary);
}

.spatial-handle--origin:hover {
  box-shadow: 0 0 14px var(--primary);
}
</style>
