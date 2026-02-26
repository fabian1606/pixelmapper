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
  opacity: 0.15;
  border: 2px solid var(--primary);
  box-shadow: 0 0 10px var(--primary);
  cursor: grab;
}

.spatial-handle--endpoint:hover {
  background: var(--primary);
  opacity: 0.35;
  box-shadow: 0 0 18px var(--primary);
}

/* ── Origin handle: diamond / square rotated 45° ─────────────────────── */
.spatial-handle--origin {
  width: 10px;
  height: 10px;
  background: var(--primary);
  opacity: 0.85;
  border: 1.5px solid rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 8px var(--primary);
  transform: translate(-50%, -50%) rotate(45deg);
}

.spatial-handle--origin:hover {
  box-shadow: 0 0 14px var(--primary);
}
</style>
