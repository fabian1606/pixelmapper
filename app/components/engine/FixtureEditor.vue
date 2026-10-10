<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import { ref, computed, watch, watchEffect, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureEditorSpatialControls from './FixtureEditorSpatialControls.vue';
import ModifierFieldOverlay from '~/components/plugin-host/ModifierFieldOverlay.vue';
import { useCamera } from './composables/use-camera';
import { useSelection } from './composables/use-selection';
import { useHistory } from './composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { MoveFixtureCommand } from './commands/move-fixture-command';
import { RotateFixtureCommand } from './commands/rotate-fixture-command';
import { SetFixtureKindConfigCommand } from './commands/set-fixture-kind-config-command';
import { inject } from 'vue';
import type { EffectEngine } from '~/utils/engine/engine';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { userColor } from '~/composables/live-ops/colors';
import CollaboratorCursors from './CollaboratorCursors.vue';
import { SetModifiersCommand } from '~/components/engine/commands/set-modifiers-command';
import { cloneModifiers } from '~/utils/engine/modifiers';
import type { ModifierInstance } from '~/utils/engine/types';
import { useDistributionToolStore } from '~/stores/distribution-tool-store';
import OrderTool from './distribution/OrderTool.vue';
import DistributionOverlay from './distribution/DistributionOverlay.vue';

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

import { WORLD_WIDTH, WORLD_HEIGHT, STAGE_SIZE_METERS } from '~/utils/engine/constants';

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
  // Hidden editor (other viewport mode active): centering against a 0×0
  // viewport would throw the camera permanently off-world.
  if (editorWidth.value < 50 || editorHeight.value < 50) return;
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
  if (editorWidth.value < 50 || editorHeight.value < 50) return;
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

const { selectedIds, editingId, focusedHandle, interaction, alignmentGuides, onViewportMouseDown, onMouseMove, onMouseUp, tryDeleteHandleAt, deleteFocusedHandle } =
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
    (fixture, before, after, description) => {
      history.execute(new SetFixtureKindConfigCommand(props.fixtures, fixture.id, before, after, description));
    },
    () => camera.scale,
    () => engineStore.sceneNodes,
    () => ({ width: editorWidth.value, height: editorHeight.value }),
  );

// ─── Alignment-guide overlay (Figma-style smart guides) ──────────────────────
const GUIDE_COLOR = '#c2578f';
/** How far a guide line extends past the outermost matched center, in CSS px. */
const GUIDE_EXTEND_PX = 8;
const WORLD_PX_PER_METER = WORLD_WIDTH / STAGE_SIZE_METERS;

const guideOverlay = computed(() => {
  const res = alignmentGuides.value;
  if (!res) return null;

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; dashed: boolean }> = [];
  const marks: Array<{ x: number; y: number }> = [];
  for (const g of res.guides) {
    // draggedPoint (not draggedCenter): for an edge match the line runs along
    // the group's outermost row, which the dragged center doesn't lie on.
    const pts = [...g.matchedCenters, g.draggedPoint];
    // A dot over every involved fixture (group members individually), not just
    // the aggregate center — so a group's alignment reads as "all these dots
    // line up on one axis" while the guide line runs through its center.
    for (const p of g.marks) {
      const v = worldToViewport(p[0]!, p[1]!);
      marks.push({ x: v.x, y: v.y });
    }
    if (g.axis === 0) {
      const ys = pts.map(p => p[1]!);
      const a = worldToViewport(g.value, Math.min(...ys));
      const b = worldToViewport(g.value, Math.max(...ys));
      lines.push({ x1: a.x, y1: a.y - GUIDE_EXTEND_PX, x2: b.x, y2: b.y + GUIDE_EXTEND_PX, dashed: g.dashed });
    } else {
      const xs = pts.map(p => p[0]!);
      const a = worldToViewport(Math.min(...xs), g.value);
      const b = worldToViewport(Math.max(...xs), g.value);
      lines.push({ x1: a.x - GUIDE_EXTEND_PX, y1: a.y, x2: b.x + GUIDE_EXTEND_PX, y2: b.y, dashed: g.dashed });
    }
  }

  const gaps: Array<{ x1: number; y1: number; x2: number; y2: number; lx: number; ly: number; label: string }> = [];
  for (const gap of res.spacing) {
    const label = `${(gap.distance / WORLD_PX_PER_METER).toFixed(2)} m`;
    const a = worldToViewport(gap.from[0]!, gap.from[1]!);
    const b = worldToViewport(gap.to[0]!, gap.to[1]!);
    gaps.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, lx: (a.x + b.x) / 2, ly: (a.y + b.y) / 2, label });
  }

  return { lines, marks, gaps };
});

// Viewport-space endpoints of the shift line-select tool, for the SVG overlay.
const lineOverlay = computed(() => {
  if (interaction.value.type !== 'line') return null;
  const a = worldToViewport(interaction.value.start.x, interaction.value.start.y);
  const b = worldToViewport(interaction.value.end.x, interaction.value.end.y);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
});

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

let modifierDragBeforeEffects: ModifierInstance[] | null = null;
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

function handleModifierChange(modifier: ModifierInstance, changes: Partial<ModifierInstance>) {
  if (!effectEngine) return;
  if (!modifierDragBeforeEffects) modifierDragBeforeEffects = cloneModifiers(effectEngine.modifiers);
  Object.assign(modifier, changes);
  engineStore.flushEngineOutput?.();
}

function handleSpatialDragStart() {
  isSpatialDragging.value = true;
}

function handleModifierDragEnd(_modifier?: ModifierInstance, description = 'Update Spatial Handle') {
  isSpatialDragging.value = false;
  if (modifierDragBeforeEffects && effectEngine) {
    const afterEffects = cloneModifiers(effectEngine.modifiers);
    history.execute(new SetModifiersCommand(effectEngine, modifierDragBeforeEffects, afterEffects, description));
    modifierDragBeforeEffects = null;
  }
}

// ─── Distribution order tools (plan M4.3) ─────────────────────────────────────
const distributionTool = useDistributionToolStore();
/** A reassign session is on for the active modifier. */
const orderToolActive = computed(() => !!activeModifier.value && distributionTool.modifierId === activeModifier.value.id);

/** Live order change from the canvas tool. */
function handleOrderChange(distribution: ModifierInstance['distribution']) {
  if (!activeModifier.value) return;
  handleModifierChange(activeModifier.value, { distribution });
  liveBus.dispatch('modifier.update', { effectId: activeModifier.value.id, changes: { distribution } });
}

// A reassign session commits once when it ends (Esc, Done, line drawn, other modifier).
watch(() => distributionTool.modifierId, () => handleModifierDragEnd(undefined, 'Reassign Order'));
// Selecting another modifier ends the tool.
watch(() => activeModifier.value?.id, (id) => {
  if (distributionTool.modifierId && distributionTool.modifierId !== id) distributionTool.stop();
});

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

// ─── Cursor ───────────────────────────────────────────────────────────────────
const cursor = ref('default');

function updateCursor(e: MouseEvent) {
  const t = interaction.value.type;
  if (t === 'drag') { cursor.value = 'grabbing'; return; }
  if (t === 'kind-handle') { cursor.value = 'grabbing'; return; }
  if (t === 'line') { cursor.value = 'crosshair'; return; }
  // Shift held (before/without a drag) previews the line-select tool.
  if (e.shiftKey) { cursor.value = 'crosshair'; return; }
  if (t === 'rotate') { cursor.value = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Cpath d=\'M10 2 A8 8 0 1 1 2 10\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpolygon points=\'10,0 7,4 13,4\' fill=\'white\'/%3E%3C/svg%3E") 10 10, alias'; return; }
  const r = rect();
  const vx = e.clientX - r.left;
  const vy = e.clientY - r.top;
  const handleHit = fixtureCanvas.value?.hitTestHandle?.(vx, vy);
  if (handleHit) {
    const role = props.fixtures.find(f => String(f.id) === handleHit.fixtureId)?.kind?.compiled?.handles.find(h => h.id === handleHit.handleId)?.role;
    cursor.value = role === 'midpoint' ? 'copy' : 'grab';
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
 * Right-click / ctrl-click on a kind handle deletes it (when the kind's
 * `onHandleDelete` allows it). Using the `contextmenu` event rather than `mousedown` button=2
 * keeps this working on macOS where ctrl-click fires contextmenu without a
 * matching button=2 mousedown.
 */
function handleContextMenu(e: MouseEvent) {
  e.preventDefault();
  const r = rect();
  if (tryDeleteHandleAt(e.clientX - r.left, e.clientY - r.top)) {
    fixtureCanvas.value?.sync();
  }
}

/**
 * Keyboard delete for the focused kind handle.
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
  if (!focusedHandle.value) return;
  if (deleteFocusedHandle()) {
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
  if (t === 'drag' || t === 'rotate' || t === 'kind-handle') fixtureCanvas.value?.sync();
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
      :focused-handle="focusedHandle"
      :interaction="interaction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />

    <!-- Shift line-select tool: the virtual line drawn across fixtures -->
    <svg
      v-if="lineOverlay"
      class="absolute inset-0 w-full h-full pointer-events-none"
    >
      <line
        :x1="lineOverlay.x1"
        :y1="lineOverlay.y1"
        :x2="lineOverlay.x2"
        :y2="lineOverlay.y2"
        stroke="var(--primary, #3b82f6)"
        stroke-width="1.5"
        stroke-dasharray="4 4"
      />
      <circle :cx="lineOverlay.x1" :cy="lineOverlay.y1" r="3" fill="var(--primary, #3b82f6)" />
      <circle :cx="lineOverlay.x2" :cy="lineOverlay.y2" r="3" fill="var(--primary, #3b82f6)" />
    </svg>

    <!-- Alignment guides: center-align lines + equal-spacing labels while dragging -->
    <svg
      v-if="guideOverlay"
      class="absolute inset-0 w-full h-full pointer-events-none"
    >
      <line
        v-for="(l, i) in guideOverlay.lines"
        :key="`gl-${i}`"
        :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
        :stroke="GUIDE_COLOR"
        stroke-width="1"
        :stroke-dasharray="l.dashed ? '4 4' : undefined"
      />
      <circle
        v-for="(m, i) in guideOverlay.marks"
        :key="`gm-${i}`"
        :cx="m.x" :cy="m.y" r="2.5"
        fill="none"
        :stroke="GUIDE_COLOR"
        stroke-width="1"
      />
      <g v-for="(gap, i) in guideOverlay.gaps" :key="`gs-${i}`">
        <line
          :x1="gap.x1" :y1="gap.y1" :x2="gap.x2" :y2="gap.y2"
          :stroke="GUIDE_COLOR"
          stroke-width="1"
          stroke-dasharray="2 3"
        />
        <rect
          :x="gap.lx - (gap.label.length * 3.4 + 6)"
          :y="gap.ly - 9"
          :width="gap.label.length * 6.8 + 12"
          height="18"
          rx="4"
          :fill="GUIDE_COLOR"
        />
        <text
          :x="gap.lx" :y="gap.ly"
          fill="white"
          font-size="11"
          font-family="ui-monospace, monospace"
          text-anchor="middle"
          dominant-baseline="central"
        >{{ gap.label }}</text>
      </g>
    </svg>

    <!-- Distribution of the active modifier: rank badges, group colors, head arrows -->
    <DistributionOverlay
      v-if="activeModifier?.distribution && !orderToolActive"
      :fixtures="fixtures"
      :modifier="activeModifier"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :world-to-viewport="worldToViewport"
      :camera="camera"
    />
    <OrderTool
      v-if="orderToolActive && activeModifier"
      :modifier="activeModifier"
      :fixtures="fixtures"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-to-world="viewportToWorld"
      :world-to-viewport="worldToViewport"
      :hit-test="(vx, vy) => fixtureCanvas?.hitTest(vx, vy)"
      @change="handleOrderChange"
      @done="distributionTool.stop()"
    />

    <!-- Collaborator cursors + remote selections -->
    <CollaboratorCursors :camera="camera" />

    <!-- Active modifier field preview while dragging spatial handles (preview pool) -->
    <div
      v-if="isSpatialDragging && activeModifier"
      class="absolute left-0 top-0 pointer-events-none"
      :style="{
        width: `${WORLD_WIDTH}px`,
        height: `${WORLD_HEIGHT}px`,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        transformOrigin: '0 0',
      }"
    >
      <ModifierFieldOverlay :modifier="activeModifier" :bpm="effectEngine?.globalBpm.value ?? 120" />
    </div>

    <FixtureEditorSpatialControls
      v-if="activeModifier && !orderToolActive && ((activeModifier.distribution?.scope === 'across' && ['linear', 'radial', 'conical'].includes(activeModifier.distribution.mode)) || !!activeModifier.params?.origin)"
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
