<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useCamera } from '~/components/engine/composables/use-camera';
import { useEditorViewport } from '~/components/engine/composables/use-editor-viewport';
import { WORLD_WIDTH, WORLD_HEIGHT } from '~/utils/engine/constants';
import FixtureCanvas from '~/components/engine/FixtureCanvas.vue';
import type { Interaction } from '~/components/engine/composables/use-selection';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
  canvasScale: number;
}>();

const engineStore = useEngineStore();
const { flatFixtures } = storeToRefs(engineStore);

const viewportEl = ref<HTMLElement | null>(null);
const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

const { camera, fitAll, onWheel } = useCamera();

function zoomToFit() {
  const points = flatFixtures.value.map(f => ({
    wx: f.fixturePosition.x * WORLD_WIDTH,
    wy: f.fixturePosition.y * WORLD_HEIGHT,
  }));
  if (points.length === 0) return;
  fitAll(points, editorWidth.value, editorHeight.value);
  fixtureCanvas.value?.draw();
}

const { editorWidth, editorHeight } = useEditorViewport(
  viewportEl,
  100,
  100,
  () => zoomToFit(),
  () => fixtureCanvas.value?.draw(),
);

// Static "idle" interaction — FixtureCanvas only acts on type === 'marquee'.
const idleInteraction: Interaction = { type: 'idle' };
const emptySelection = new Set<string | number>();

// Re-sync fixture geometry when something in the design changes (add/move/remove).
watch(() => engineStore._syncTrigger, () => {
  fixtureCanvas.value?.sync();
});

// Re-fit when the fixture set changes from empty → non-empty.
watch(() => flatFixtures.value.length, (n, prev) => {
  if (prev === 0 && n > 0) zoomToFit();
});

// ─── Play-mode interaction (pan + zoom only — no fixture editing) ──────────────
function rect(): DOMRect | null {
  return viewportEl.value?.getBoundingClientRect() ?? null;
}

function handleWheel(e: WheelEvent) {
  if (props.editMode) return;
  const r = rect();
  if (!r) return;
  e.stopPropagation();
  onWheel(e, r);
}

const isPanning = ref(false);
let panStartX = 0, panStartY = 0;
let panStartCamX = 0, panStartCamY = 0;

function handleMouseDown(e: MouseEvent) {
  if (props.editMode) return;
  if (e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  isPanning.value = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartCamX = camera.x;
  panStartCamY = camera.y;
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
}

function onPanMove(e: MouseEvent) {
  if (!isPanning.value) return;
  camera.x = panStartCamX + (e.clientX - panStartX);
  camera.y = panStartCamY + (e.clientY - panStartY);
}

function onPanUp() {
  isPanning.value = false;
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
}

const cursorClass = computed(() => {
  if (props.editMode) return 'pointer-events-none';
  return isPanning.value
    ? 'pointer-events-auto cursor-grabbing'
    : 'pointer-events-auto cursor-grab';
});
</script>

<template>
  <div
    ref="viewportEl"
    class="absolute inset-0 overflow-hidden rounded bg-[#101010]"
    :class="cursorClass"
    @wheel.prevent="handleWheel"
    @mousedown="handleMouseDown"
  >
    <FixtureCanvas
      ref="fixtureCanvas"
      :fixtures="flatFixtures"
      :selected-ids="emptySelection"
      :interaction="idleInteraction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />
  </div>
</template>
