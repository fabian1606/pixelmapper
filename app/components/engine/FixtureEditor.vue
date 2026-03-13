<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import { ref, computed, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureEditorSpatialControls from './FixtureEditorSpatialControls.vue';
import { useCamera } from './composables/use-camera';
import { useSelection } from './composables/use-selection';
import { useHistory } from './composables/use-history';
import { MoveFixtureCommand } from './commands/move-fixture-command';
import { RotateFixtureCommand } from './commands/rotate-fixture-command';
import { inject } from 'vue';
import type { EffectEngine } from '~/utils/engine/engine';
import { SetModifiersCommand, cloneEffectsList } from './commands/set-modifiers-command';
import type { Effect } from '~/utils/engine/types';

interface Props {
  fixtures: Fixture[];
  colors: Map<string | number, string>;
  width?: number;
  height?: number;
}

interface Emits {
  (e: 'deleteFixture', fixture: Fixture): void;
  (e: 'delete-selected'): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

import { WORLD_WIDTH, WORLD_HEIGHT } from '~/utils/engine/constants';

// ─── Responsive Sizing ───────────────────────────────────────────────────────
const viewportEl = ref<HTMLElement | null>(null);
import { useEditorViewport } from './composables/use-editor-viewport';

const { editorWidth, editorHeight } = useEditorViewport(
  viewportEl,
  props.width || 800,
  props.height || 600,
  () => {
    if (props.fixtures.length > 0) zoomToFit();
  },
  () => {
    fixtureCanvas.value?.draw();
  }
);

// ─── Composables ─────────────────────────────────────────────────────────────
const { camera, viewportToWorld, worldToViewport, onWheel, centerOn, fitAll } = useCamera();
const history = useHistory();

// ─── Zoom ─────────────────────────────────────────────────────────────────────
function zoomTo(node: SceneNode) {
  let avgPos = { x: 0, y: 0 };
  if (node instanceof FixtureGroup) {
    const gf = node.getAllFixtures();
    if (gf.length === 0) return;
    avgPos.x = gf.reduce((s: number, f: Fixture) => s + f.fixturePosition.x, 0) / gf.length;
    avgPos.y = gf.reduce((s: number, f: Fixture) => s + f.fixturePosition.y, 0) / gf.length;
  } else {
    avgPos.x = (node as Fixture).fixturePosition.x;
    avgPos.y = (node as Fixture).fixturePosition.y;
  }
  if (camera.scale < 1.0) camera.scale = 1.0;
  centerOn(avgPos.x * WORLD_WIDTH, avgPos.y * WORLD_HEIGHT, editorWidth.value, editorHeight.value);
}

function zoomToFit() {
  const points = props.fixtures.map(f => ({
    wx: f.fixturePosition.x * WORLD_WIDTH,
    wy: f.fixturePosition.y * WORLD_HEIGHT,
  }));
  fitAll(points, editorWidth.value, editorHeight.value);
  fixtureCanvas.value?.draw();
}

defineExpose({ zoomTo, zoomToFit });

const selectedIdsModel = defineModel<Set<string | number>>('selectedIds', { default: () => new Set() });

const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

const { selectedIds, interaction, onViewportMouseDown, onMouseMove, onMouseUp } =
  useSelection(
    () => props.fixtures,
    () => WORLD_WIDTH,
    () => WORLD_HEIGHT,
    viewportToWorld,
    (before, after) => {
      history.execute(new MoveFixtureCommand(props.fixtures, before, after));
    },
    (before, after) => {
      history.execute(new RotateFixtureCommand(props.fixtures, before, after));
    },
    selectedIdsModel,
    () => fixtureCanvas.value,
  );

const effectEngine = inject<EffectEngine>('effectEngine');

const activeModifier = computed(() => effectEngine?.activeModifier.value ?? null);

let modifierDragBeforeEffects: Effect[] | null = null;
const isSpatialDragging = ref(false);

watch(selectedIdsModel, (newVal) => {
  if (effectEngine && newVal.size === 0) {
    effectEngine.activeModifier.value = null;
  }
});

function handleModifierChange(modifier: Effect, changes: Partial<Effect>) {
  if (!effectEngine) return;
  if (!modifierDragBeforeEffects) modifierDragBeforeEffects = cloneEffectsList(effectEngine.effects);
  Object.assign(modifier, changes);
}

function handleSpatialDragStart() {
  isSpatialDragging.value = true;
}

function handleModifierDragEnd(modifier: Effect) {
  isSpatialDragging.value = false;
  if (modifierDragBeforeEffects && effectEngine) {
    const afterEffects = cloneEffectsList(effectEngine.effects);
    history.execute(new SetModifiersCommand(effectEngine, modifierDragBeforeEffects, afterEffects, 'Update Spatial Handle'));
    modifierDragBeforeEffects = null;
  }
}

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

// ─── Viewport event delegation ─────────────────────────────────────────────────
function handleWheel(e: WheelEvent)     { onWheel(e, rect()); }
function handleMouseDown(e: MouseEvent) { onViewportMouseDown(e, rect()); }
function handleMouseMove(e: MouseEvent) { onMouseMove(e, rect()); fixtureCanvas.value?.sync(); }
function handleMouseUp()                { onMouseUp(); }
</script>

<template>
  <div
    ref="viewportEl"
    v-bind="$attrs"
    class="viewport"
    @wheel.prevent="handleWheel"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
  >
    <!-- WASM Canvas: grid, fixture glows, borders, marquee -->
    <FixtureCanvas
      ref="fixtureCanvas"
      :fixtures="fixtures"
      :selected-ids="selectedIds"
      :interaction="interaction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />

    <!-- Effect Spatial Preview -->
    <div
      v-if="isSpatialDragging && activeModifier && activeModifier.getPreviewCSS"
      class="absolute left-0 top-0 pointer-events-none"
      :style="{
        width: `${WORLD_WIDTH}px`,
        height: `${WORLD_HEIGHT}px`,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        transformOrigin: '0 0',
      }"
    >
      <div
        class="pointer-events-none"
        :style="activeModifier.getPreviewCSS({
          worldWidth: WORLD_WIDTH,
          worldHeight: WORLD_HEIGHT,
          camera,
          viewportWidth: editorWidth,
          viewportHeight: editorHeight
        })"
      />
    </div>

    <FixtureEditorSpatialControls
      v-if="activeModifier && activeModifier.fanning !== 0"
      :viewport-el="viewportEl"
      :editor-width="editorWidth"
      :editor-height="editorHeight"
      :camera="camera"
      :active-modifier="activeModifier"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :world-to-viewport="worldToViewport"
      @dragStart="handleSpatialDragStart"
      @modifierChange="handleModifierChange"
      @modifierDragEnd="handleModifierDragEnd"
      @redraw="() => fixtureCanvas?.draw()"
    />
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  background: #101010;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  outline: none;
}
</style>
