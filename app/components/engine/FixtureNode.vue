<script setup lang="ts">
import type { Fixture } from '~/utils/engine/core/fixture';

interface Props {
  fixture: Fixture;
  radius?: number;
  isDragging?: boolean;
  isSelected?: boolean;
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
}

const props = withDefaults(defineProps<Props>(), {
  radius: 18,
  isDragging: false,
  isSelected: false,
});

const emit = defineEmits<Emits>();
</script>

<template>
  <div
    class="fixture-node"
    :class="{ 'is-dragging': isDragging, 'is-selected': isSelected }"
    :style="{
      width:  `${radius * 2}px`,
      height: `${radius * 2}px`,
    }"
    @mousedown.prevent.stop="emit('dragstart', $event)"
  >
    <span class="fixture-label">{{ fixture.id }}</span>
  </div>
</template>

<style scoped>
.fixture-node {
  position: absolute;
  border-radius: 50%;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.22);
  transition: border-color 0.1s ease;
  z-index: 1;
}

.fixture-node:hover {
  border-color: rgba(255, 255, 255, 0.6);
}

.fixture-node.is-selected {
  border-color: rgba(99, 179, 237, 0.9);
  box-shadow: 0 0 0 2px rgba(99, 179, 237, 0.35);
}

.fixture-node.is-dragging {
  cursor: grabbing;
  border-color: rgba(255, 255, 255, 0.9);
  z-index: 10;
}

.fixture-label {
  font-size: 9px;
  font-family: monospace;
  color: rgba(255, 255, 255, 0.8);
  pointer-events: none;
  text-shadow: 0 0 4px rgba(0, 0, 0, 1);
}
</style>
