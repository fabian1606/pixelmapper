<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  /**
   * 'origin' = square-style anchor (reposition center), 'endpoint' = circle
   * (direction + magnitude), 'point' = ringed dot of a canvas-hinted param
   * (plan M4), 'knob' = small dot on a radius ring.
   */
  type?: 'origin' | 'endpoint' | 'point' | 'knob';
  x?: number;
  y?: number;
  /** CSS color of a 'point' / 'knob' handle (default: theme primary). */
  color?: string;
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
}

const props = withDefaults(defineProps<Props>(), { type: 'endpoint' });
const emit = defineEmits<Emits>();

const transformStyle = computed(() => {
  if (props.x === undefined || props.y === undefined) return {};
  const base = `translate3d(${props.x}px, ${props.y}px, 0) translate(-50%, -50%)`;
  return {
    transform: props.type === 'origin' ? `${base} rotate(45deg)` : base,
    ...(props.color ? { '--handle-color': props.color } : {}),
  };
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
  --handle-color: var(--primary);
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

/* ── Canvas-hint point: colored dot with a light ring ────────────────── */
.spatial-handle--point {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--handle-color);
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 8px var(--handle-color);
}

.spatial-handle--point:hover {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 14px var(--handle-color);
}

/* ── Radius knob: small dot on the ring ──────────────────────────────── */
.spatial-handle--knob {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--handle-color);
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  cursor: ew-resize;
}
</style>
