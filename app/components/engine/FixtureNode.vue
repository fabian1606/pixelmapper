<script setup lang="ts">
import type { Fixture } from '~/utils/engine/core/fixture';

interface Props {
  fixture: Fixture;
  radius?: number;
  isDragging?: boolean;
  isSelected?: boolean;
  showLabels?: boolean;
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
}

const props = withDefaults(defineProps<Props>(), {
  radius: 18,
  isDragging: false,
  isSelected: false,
  showLabels: true,
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
    <div v-if="showLabels" class="fixture-label">{{ fixture.name }}</div>
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
  border-color: var(--primary);
}

.fixture-node.is-dragging {
  cursor: grabbing;
  border-color: var(--primary);
  z-index: 10;
}

.fixture-label {
  position: absolute;
  top: 120%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  font-size: 13px;
  font-family: inherit;
  color: var(--muted-foreground);
  opacity: 0.9;
  pointer-events: none;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
</style>
