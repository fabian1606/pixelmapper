<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import { ref, computed, watch, watchEffect, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureEditorSpatialControls from './FixtureEditorSpatialControls.vue';
import { useCamera } from './composables/use-camera';
import { useSelection } from './composables/use-selection';
import { useHistory } from './composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { MoveFixtureCommand } from './commands/move-fixture-command';
import { RotateFixtureCommand } from './commands/rotate-fixture-command';
import { ReshapeStripCommand } from './commands/reshape-strip-command';
import { inject } from 'vue';
import type { EffectEngine } from '~/utils/engine/engine';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { userColor } from '~/composables/live-ops/colors';
import CollaboratorCursors from './CollaboratorCursors.vue';
import { SetModifiersCommand, cloneEffectsList } from './commands/set-modifiers-command';
import type { Effect } from '~/utils/engine/types';

interface Props {
  fixtures: Fixture[];
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
const engineStore = useEngineStore();

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

const { selectedIds, editingId, editingVertex, interaction, onViewportMouseDown, onMouseMove, onMouseUp, tryDeleteVertexAt, deleteEditingVertex } =
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
    (before, after) => {
      history.execute(new ReshapeStripCommand(props.fixtures, before, after));
    },
  );

const effectEngine = inject<EffectEngine>('effectEngine');
const liveBus = useLiveBusStore();
const { remoteSelections, remoteCameras, followedSessionId } = storeToRefs(liveBus);

// Follow mode: mirror the remote user's full camera state (position + zoom)
// — but only when they're in the editor (their camera has context='editor').
watchEffect(() => {
  const sid = followedSessionId.value;
  if (!sid) return;
  const remote = remoteCameras.value.get(sid);
  if (!remote) return;
  if (remote.context && remote.context !== 'editor') return;
  camera.x = remote.x;
  camera.y = remote.y;
  camera.scale = remote.scale;
});

// Broadcast camera state so followers can mirror our viewport
watch(camera, (c) => {
  if (!followedSessionId.value) {
    liveBus.dispatch('camera.sync', { x: c.x, y: c.y, scale: c.scale, context: 'editor' });
  }
}, { deep: true });

const activeModifier = computed(() => effectEngine?.activeModifier.value ?? null);

let modifierDragBeforeEffects: Effect[] | null = null;
const isSpatialDragging = ref(false);

watch(selectedIdsModel, (newVal) => {
  if (effectEngine && newVal.size === 0) {
    effectEngine.activeModifier.value = null;
  }
  liveBus.dispatch('selection.set', { ids: Array.from(newVal) });
});

watch([() => engineStore.channelsRevision, () => history.version.value], () => {
  fixtureCanvas.value?.sync();
});

watch(remoteSelections, (sel) => {
  const entries: Array<{ id: string; r: number; g: number; b: number }> = [];
  for (const [userId, ids] of sel.entries()) {
    const hex = userColor(userId).replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    for (const id of ids) {
      entries.push({ id: String(id), r, g, b });
    }
  }
  fixtureCanvas.value?.syncRemoteSelections(entries);
});

function handleModifierChange(modifier: Effect, changes: Partial<Effect>) {
  if (!effectEngine) return;
  if (!modifierDragBeforeEffects) modifierDragBeforeEffects = cloneEffectsList(effectEngine.effects);
  Object.assign(modifier, changes);
  engineStore.flushEngineOutput?.();
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

// ─── Cursor ───────────────────────────────────────────────────────────────────
const cursor = ref('default');

function updateCursor(e: MouseEvent) {
  const t = interaction.value.type;
  if (t === 'drag') { cursor.value = 'grabbing'; return; }
  if (t === 'strip-vertex') { cursor.value = 'grabbing'; return; }
  if (t === 'rotate') { cursor.value = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Cpath d=\'M10 2 A8 8 0 1 1 2 10\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpolygon points=\'10,0 7,4 13,4\' fill=\'white\'/%3E%3C/svg%3E") 10 10, alias'; return; }
  const r = rect();
  const vx = e.clientX - r.left;
  const vy = e.clientY - r.top;
  const handleHit = fixtureCanvas.value?.hitTestStripEndpoint?.(vx, vy);
  if (handleHit) {
    cursor.value = handleHit.split(':')[1] === 'mid' ? 'copy' : 'grab';
  } else if (fixtureCanvas.value?.hitTestRotationZone(vx, vy)) {
    cursor.value = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Cpath d=\'M10 2 A8 8 0 1 1 2 10\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpolygon points=\'10,0 7,4 13,4\' fill=\'white\'/%3E%3C/svg%3E") 10 10, alias';
  } else if (fixtureCanvas.value?.hitTest(vx, vy)) {
    cursor.value = 'grab';
  } else {
    cursor.value = 'default';
  }
}

// ─── Viewport event delegation ─────────────────────────────────────────────────
function handleWheel(e: WheelEvent) {
  liveBus.followedSessionId = null; // user navigated → stop following
  onWheel(e, rect());
}
function handleMouseDown(e: MouseEvent) {
  // Middle-mouse or space-drag pans the viewport — stop following
  if (e.button === 1) liveBus.followedSessionId = null;
  onViewportMouseDown(e, rect());
}

/**
 * Right-click / ctrl-click on a strip vertex deletes it (when the strip has
 * > 2 vertices). Using the `contextmenu` event rather than `mousedown` button=2
 * keeps this working on macOS where ctrl-click fires contextmenu without a
 * matching button=2 mousedown.
 */
function handleContextMenu(e: MouseEvent) {
  e.preventDefault();
  const r = rect();
  if (tryDeleteVertexAt(e.clientX - r.left, e.clientY - r.top)) {
    fixtureCanvas.value?.sync();
  }
}

/**
 * Keyboard delete for the focused strip vertex.
 *
 * Registered in the CAPTURE phase so it fires before the page-level
 * `useShortcuts` Delete-handler (which would otherwise delete the whole
 * fixture). If a vertex is actually focused and removable we consume the
 * event with `stopImmediatePropagation` so no other handler runs. When no
 * vertex is focused we leave the event alone and the normal "delete fixture"
 * behaviour kicks in.
 */
function handleKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return;
  const target = e.target as HTMLElement | null;
  if (target && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )) return;
  if (!editingVertex.value) return;
  if (deleteEditingVertex()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    fixtureCanvas.value?.sync();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, { capture: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown, { capture: true });
});
function handleMouseMove(e: MouseEvent) {
  onMouseMove(e, rect());
  const t = interaction.value.type;
  if (t === 'drag' || t === 'rotate' || t === 'strip-vertex') fixtureCanvas.value?.sync();
  updateCursor(e);

  // Broadcast cursor position (bus throttles via rAF internally)
  const r = rect();
  const world = viewportToWorld(e.clientX - r.left, e.clientY - r.top);
  liveBus.dispatch('cursor.move', { wx: world.x, wy: world.y, context: 'editor' });

  // Broadcast live drag positions if dragging
  if (interaction.value.type === 'drag') {
    const iv = interaction.value;
    const fixtures: Array<{ id: string | number; x: number; y: number }> = [];
    for (const f of props.fixtures) {
      if (iv.startPositions.has(f.id)) {
        fixtures.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y });
      }
    }
    if (fixtures.length > 0) liveBus.dispatch('fixture.drag', { fixtures });
  }
}
function handleMouseUp(e?: MouseEvent) {
  const t = interaction.value.type;
  const wasInteracting = t === 'drag' || t === 'rotate';
  onMouseUp();
  if (wasInteracting) fixtureCanvas.value?.sync();
  if (e) updateCursor(e); else cursor.value = 'default';
}
</script>

<template>
  <div
    ref="viewportEl"
    v-bind="$attrs"
    class="viewport"
    :style="{ cursor }"
    @wheel.prevent="handleWheel"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @contextmenu="handleContextMenu"
  >
    <!-- WASM Canvas: grid, fixture glows, borders, marquee -->
    <FixtureCanvas
      ref="fixtureCanvas"
      :fixtures="fixtures"
      :selected-ids="selectedIds"
      :editing-id="editingId"
      :editing-vertex="editingVertex"
      :interaction="interaction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />

    <!-- Collaborator cursors + remote selections -->
    <CollaboratorCursors :camera="camera" />

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
      v-if="activeModifier && (activeModifier.fanning !== 0 || !!(activeModifier as any).sequencerParams)"
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
      @redraw="() => { engineStore.flushEngineOutput?.(); fixtureCanvas?.draw(); }"
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
  user-select: none;
  outline: none;
}
</style>
