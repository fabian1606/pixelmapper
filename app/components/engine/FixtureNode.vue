<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureContextMenu from './FixtureContextMenu.vue';

interface Props {
  fixture: Fixture;
  radius?: number;
  isDragging?: boolean;
  isSelected?: boolean;
  showLabels?: boolean;
  visible?: boolean;
}

interface Emits {
  (e: 'dragstart', event: MouseEvent): void;
  (e: 'delete', fixture: Fixture): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}

const props = withDefaults(defineProps<Props>(), {
  radius: 18,
  isDragging: false,
  isSelected: false,
  showLabels: true,
  visible: true,
});

const emit = defineEmits<Emits>();
</script>

<template>
  <FixtureContextMenu
    :node="fixture as unknown as SceneNode"
    :can-delete="true"
    :can-group="true"
    :can-ungroup="!!fixture.parent"
    @delete="emit('delete', fixture)"
    @group="emit('group')"
    @ungroup="emit('ungroup', fixture.parent!)"
  >
    <div
      v-show="visible"
      class="fixture-node"
      v-bind="$attrs"
      :class="{ 'is-dragging': isDragging, 'is-selected': isSelected, 'is-multi-head': fixture.beams && fixture.beams.length > 1 }"
      :style="{
        width:  `${radius * 2 * (fixture.fixtureSize?.x ?? 1)}px`,
        height: `${radius * 2 * (fixture.fixtureSize?.y ?? 1)}px`,
      }"
      @mousedown.prevent.stop="emit('dragstart', $event)"
    >
      <!-- beams are rendered on the canvas layer below; no HTML overlay needed -->
      <div v-if="showLabels" class="fixture-label">{{ fixture.name }}</div>
    </div>
  </FixtureContextMenu>
</template>

<style scoped>
.fixture-node {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 50%;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.22);
  transition: border-color 0.1s ease;
  z-index: 1;
}

.fixture-node.is-multi-head {
  border-radius: 8px;
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
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--muted-foreground);
  opacity: 0.9;
  pointer-events: none;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
</style>
