<script setup lang="ts">
interface Props {
  /** 'origin' = square-style anchor (reposition center), 'endpoint' = circle (direction + magnitude) */
  type?: 'origin' | 'endpoint';
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
}

withDefaults(defineProps<Props>(), { type: 'endpoint' });
const emit = defineEmits<Emits>();
</script>

<template>
  <div
    class="spatial-handle"
    :class="[`spatial-handle--${type}`]"
    @mousedown.prevent.stop="emit('dragstart', $event)"
  />
</template>

<style scoped>
.spatial-handle {
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: crosshair;
  z-index: 20;
  transition: box-shadow 0.1s;
}

/* ── Endpoint handle: circle ──────────────────────────────────────────── */
.spatial-handle--endpoint {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 200, 50, 0.15);
  border: 2px solid rgba(255, 200, 50, 0.9);
  box-shadow: 0 0 10px rgba(255, 200, 50, 0.4);
}

.spatial-handle--endpoint:hover {
  background: rgba(255, 200, 50, 0.35);
  box-shadow: 0 0 18px rgba(255, 200, 50, 0.7);
}

/* ── Origin handle: diamond / square rotated 45° ─────────────────────── */
.spatial-handle--origin {
  width: 10px;
  height: 10px;
  background: rgba(255, 200, 50, 0.85);
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 8px rgba(255, 200, 50, 0.5);
  transform: translate(-50%, -50%) rotate(45deg);
}

.spatial-handle--origin:hover {
  box-shadow: 0 0 14px rgba(255, 200, 50, 0.8);
}
</style>
