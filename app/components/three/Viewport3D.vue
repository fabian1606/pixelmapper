<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Move, RotateCw } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { MoveFixtureCommand, type FixturePositionSnapshot } from '~/components/engine/commands/move-fixture-command';
import { RotateFixtureCommand, type FixtureRotationSnapshot } from '~/components/engine/commands/rotate-fixture-command';
import { STAGE_SIZE_METERS } from '~/utils/engine/constants';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import type { GizmoMode, SelectionModifiers, ThreeSceneManager, TransformDelta } from './scene/three-scene-manager';
import {
  isAdditiveModifier,
  buildAncestorPath,
  resolveClickSelection,
  createDoubleClickTracker,
} from '~/utils/engine/selection-logic';
import {
  resolveAlignmentContext,
  buildAlignmentSession,
  queryAlignment,
  bboxCenter,
  ALIGN_TOLERANCE_PX,
  type AlignmentSession,
} from '~/utils/engine/alignment-guides';

const props = defineProps<{ active: boolean }>();

const engineStore = useEngineStore();
const { selectedIds, layoutRevision, flatFixtures, sceneNodes } = storeToRefs(engineStore);
const history = useHistory();
const liveBus = useLiveBusStore();

const containerEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const gizmoMode = ref<GizmoMode>('translate');

let manager: ThreeSceneManager | null = null;
let resizeObserver: ResizeObserver | null = null;

// ── Selection sync (both directions) ─────────────────────────────────────────

/** Groups select their descendant fixtures — same walk as the 2D canvas. */
function effectiveFixtureSelection(): Set<string | number> {
  const out = new Set<string | number>();
  for (const f of flatFixtures.value) {
    let c: Fixture | { id: string | number; parent: unknown } | null = f;
    while (c) {
      if (selectedIds.value.has(c.id)) {
        out.add(f.id);
        break;
      }
      c = (c as { parent: typeof c | null }).parent;
    }
  }
  return out;
}

/** Gizmo toggle only makes sense once at least one fixture is selected. */
const hasFixtureSelection = computed(() => effectiveFixtureSelection().size > 0);

// Click-to-drill state — mirrors the 2D canvas's double-click-to-descend
// behaviour (use-selection.ts onDragStart): first click on a fixture selects
// its outermost group, repeated quick clicks step one level deeper. Both
// canvases share the actual resolution rules via ~/utils/engine/selection-logic
// so they can't drift apart on what a click/double-click/ctrl-click selects.
const doubleClickTracker = createDoubleClickTracker();
// Anchor fixture for Shift range-select — the last fixture clicked without
// Shift. Mirrors use-selection.ts's `rangeAnchorId` on the 2D canvas.
let rangeAnchorId: string | number | null = null;

function handleSelect(id: string | number | null, mods: SelectionModifiers) {
  const additive = isAdditiveModifier(mods);
  if (id === null) {
    if (!additive) selectedIds.value = new Set();
    return;
  }

  const fixture = flatFixtures.value.find(f => f.id === id);
  if (!fixture) {
    selectedIds.value = new Set([id]);
    return;
  }

  rangeAnchorId = fixture.id;
  const isDoubleClick = doubleClickTracker.check(fixture.id, performance.now());
  const path = buildAncestorPath(fixture as unknown as SceneNode);
  const { nextSelected, drilled } = resolveClickSelection(path, selectedIds.value, isDoubleClick, additive);
  if (drilled) doubleClickTracker.reset();
  selectedIds.value = nextSelected;
}

// Shift-CLICK on a fixture → virtual ray from the currently-selected anchor
// fixture to the clicked fixture; selects every fixture lying on it. Same rule
// as the 2D canvas (use-selection.ts), just projected through the 3D camera.
function handleShiftClick(id: string | number | null) {
  if (id === null || !manager) return;
  const orderedIds = flatFixtures.value.map(f => f.id);
  let anchor = rangeAnchorId;
  if (anchor === null || !orderedIds.includes(anchor)) {
    anchor = orderedIds.find(fid => selectedIds.value.has(fid)) ?? null;
  }
  if (anchor === null || anchor === id) {
    selectedIds.value = new Set([id]);
    return;
  }
  selectedIds.value = manager.selectAlongRay(anchor, id);
}

// Shift-drag line-select overlay — mirrors FixtureEditor.vue's 2D `lineOverlay`.
const lineOverlay = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

function handleLineDrag(line: { x1: number; y1: number; x2: number; y2: number } | null) {
  lineOverlay.value = line;
}

function handleLineSelect(ids: Set<string | number>) {
  // Matches the 2D canvas's line-select: replaces the selection outright
  // (no additive variant there either — Shift is the line-select modifier
  // itself, so there's no separate "Ctrl+Shift-drag" combo to support).
  selectedIds.value = ids;
}

// Ctrl/Cmd-drag box-select overlay — mirrors the 2D canvas's marquee tool.
const boxOverlay = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

function handleBoxDrag(box: { x1: number; y1: number; x2: number; y2: number } | null) {
  boxOverlay.value = box;
}

function handleBoxSelect(ids: Set<string | number>) {
  // Matches the 2D canvas's marquee: a hit fixture selects its outermost
  // group (buildAncestorPath root), not the fixture itself — so grouped
  // fixtures box-select as whole groups, exactly like in the 2D editor.
  const hit = new Set<string | number>();
  for (const f of flatFixtures.value) {
    if (!ids.has(f.id)) continue;
    const path = buildAncestorPath(f as unknown as SceneNode);
    hit.add(path[0]!.id);
  }
  selectedIds.value = hit;
}

// ── Gizmo drags → store mutations + one history command per drag ──────────────

let dragPositionsBefore: FixturePositionSnapshot[] | null = null;
let dragRotationsBefore: FixtureRotationSnapshot[] | null = null;

// ── Alignment guides (shared core with the 2D editor, 3 axes in meters) ───────

/** Per-axis sorted candidate centers, built once per translate drag. */
let alignSession: AlignmentSession | null = null;
/** Screen-projected equal-spacing labels, rendered as DOM pills over the canvas. */
const guideLabels = ref<Array<{ x: number; y: number; text: string }>>([]);

/**
 * Fixture center in world meters, [x, y-up, z] — same mapping as
 * fixture-adapter's fixtureWorldPosition, inlined here so this component
 * keeps three.js out of the initial bundle (the adapter imports Vector3).
 */
function fixtureCenterMeters(f: Fixture): number[] {
  return [
    (f.fixturePosition.x - 0.5) * STAGE_SIZE_METERS,
    (f.positionZ || 0) * STAGE_SIZE_METERS,
    (f.fixturePosition.y - 0.5) * STAGE_SIZE_METERS,
  ];
}

function handleDragStart() {
  const ids = effectiveFixtureSelection();
  const targets = flatFixtures.value.filter(f => ids.has(f.id));
  dragPositionsBefore = targets.map(f => ({
    id: f.id,
    x: f.fixturePosition.x,
    y: f.fixturePosition.y,
    z: f.positionZ || 0,
  }));
  dragRotationsBefore = targets.map(f => ({
    id: f.id,
    rotation: f.rotation || 0,
    tiltX: f.tiltX || 0,
    rollZ: f.rollZ || 0,
  }));

  alignSession = null;
  if (manager && targets.length > 0) {
    const candidates = resolveAlignmentContext(sceneNodes.value, selectedIds.value, manager.getVisibleFixtureIds())
      .map(c => {
        const points = c.fixtures.map(fixtureCenterMeters);
        return { id: c.id, center: bboxCenter(points), points };
      });
    if (candidates.length > 0) {
      const memberPoints = targets.map(fixtureCenterMeters);
      alignSession = buildAlignmentSession(candidates, bboxCenter(memberPoints), memberPoints);
    }
  }
}

const wrapDeg = (v: number) => {
  let w = v % 360;
  if (w < 0) w += 360;
  return w;
};

function handleDragMove(mode: GizmoMode, delta: TransformDelta): number[] | void {
  if (mode === 'translate' && dragPositionsBefore) {
    // Per axis: alignment guides win, then the zoom-tiered grid (which no
    // longer lives on TransformControls — the raw delta arrives here so both
    // snapping kinds resolve in one place, exactly like the 2D drag branch).
    const grid = manager?.getTranslateSnapSpacing() ?? null;
    let applied: number[] = [delta.position.x, delta.position.y, delta.position.z];
    if (manager && alignSession) {
      const tol = ALIGN_TOLERANCE_PX * manager.getWorldPerPixel();
      const res = queryAlignment(alignSession, applied, [tol, tol, tol], [grid, grid, grid]);
      applied = res.snappedDelta;
      manager.setAlignmentGuides(res.guides.length > 0 || res.spacing.length > 0 ? res : null);
      guideLabels.value = res.spacing.flatMap(gap => {
        const p = manager!.worldToScreen(
          (gap.from[0]! + gap.to[0]!) / 2,
          (gap.from[1]! + gap.to[1]!) / 2,
          (gap.from[2]! + gap.to[2]!) / 2,
        );
        return p.visible ? [{ x: p.x, y: p.y, text: `${gap.distance.toFixed(2)} m` }] : [];
      });
    } else if (grid !== null) {
      applied = applied.map(v => Math.round(v / grid) * grid);
    }

    const dragged: Array<{ id: string | number; x: number; y: number; z: number }> = [];
    for (const snap of dragPositionsBefore) {
      const f = flatFixtures.value.find(x => x.id === snap.id);
      if (!f) continue;
      // World meters → normalized stage fractions (x→X, y→Z, height→Y).
      f.fixturePosition.x = snap.x + applied[0]! / STAGE_SIZE_METERS;
      f.fixturePosition.y = snap.y + applied[2]! / STAGE_SIZE_METERS;
      f.positionZ = Math.max(0, (snap.z ?? 0) + applied[1]! / STAGE_SIZE_METERS);
      dragged.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ });
    }
    if (dragged.length > 0) liveBus.dispatch('fixture.drag', { fixtures: dragged });
    // Busts the layout fingerprint → layoutRevision bump → our rebuild watch
    // updates the 3D meshes; the 2D view stays live in parallel.
    engineStore.triggerCanvasSync();
    return applied;
  }
  if (mode === 'rotate' && dragRotationsBefore) {
    for (const snap of dragRotationsBefore) {
      const f = flatFixtures.value.find(x => x.id === snap.id);
      if (!f) continue;
      f.rotation = wrapDeg(snap.rotation + delta.rotationDeg);
      f.tiltX = wrapDeg((snap.tiltX ?? 0) + delta.tiltXDeg);
      f.rollZ = wrapDeg((snap.rollZ ?? 0) + delta.rollZDeg);
    }
  }
  // Busts the layout fingerprint → layoutRevision bump → our rebuild watch
  // updates the 3D meshes; the 2D view stays live in parallel.
  engineStore.triggerCanvasSync();
}

function handleDragEnd(mode: GizmoMode) {
  const all = flatFixtures.value;
  if (mode === 'translate' && dragPositionsBefore) {
    const after: FixturePositionSnapshot[] = all
      .filter(f => dragPositionsBefore!.some(s => s.id === f.id))
      .map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ || 0 }));
    history.execute(new MoveFixtureCommand(all, dragPositionsBefore, after));
  } else if (mode === 'rotate' && dragRotationsBefore) {
    const after: FixtureRotationSnapshot[] = all
      .filter(f => dragRotationsBefore!.some(s => s.id === f.id))
      .map(f => ({ id: f.id, rotation: f.rotation || 0, tiltX: f.tiltX || 0, rollZ: f.rollZ || 0 }));
    history.execute(new RotateFixtureCommand(all, dragRotationsBefore, after));
  }
  dragPositionsBefore = null;
  dragRotationsBefore = null;
  alignSession = null;
  guideLabels.value = [];
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function init() {
  if (manager || !canvasEl.value || !containerEl.value) return;
  // Dynamic import keeps the three.js chunk out of the initial bundle.
  const { ThreeSceneManager } = await import('./scene/three-scene-manager');
  manager = new ThreeSceneManager(canvasEl.value, {
    getDmx: engineStore.getOutputBuffer,
    getFixtures: () => flatFixtures.value.map(f => toRaw(f)),
    onSelect: handleSelect,
    onShiftClick: handleShiftClick,
    onLineDrag: handleLineDrag,
    onLineSelect: handleLineSelect,
    onBoxDrag: handleBoxDrag,
    onBoxSelect: handleBoxSelect,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
  });

  const rect = containerEl.value.getBoundingClientRect();
  manager.resize(rect.width, rect.height);
  manager.rebuild();
  manager.setSelection(effectiveFixtureSelection());
  manager.setGizmoMode(gizmoMode.value);

  resizeObserver = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry) manager?.resize(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(containerEl.value);

  syncRunning();
}

function syncRunning() {
  if (!manager) return;
  if (props.active && !document.hidden) manager.start();
  else manager.stop();
}

function onVisibilityChange() {
  syncRunning();
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.active || manager === null) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'g') setGizmoMode('translate');
  else if (e.key === 'r') setGizmoMode('rotate');
}

function setGizmoMode(mode: GizmoMode) {
  gizmoMode.value = mode;
  manager?.setGizmoMode(mode);
}

onMounted(() => {
  init();
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeyDown);
  resizeObserver?.disconnect();
  resizeObserver = null;
  manager?.dispose();
  manager = null;
});

watch(() => props.active, syncRunning);
watch(layoutRevision, () => manager?.rebuild());
watch(selectedIds, () => manager?.setSelection(effectiveFixtureSelection()));
</script>

<template>
  <div ref="containerEl" class="relative w-full h-full min-w-0 overflow-hidden bg-black">
    <canvas ref="canvasEl" class="absolute inset-0 w-full h-full block" />

    <!-- Shift line-select tool: the virtual line drawn across fixtures — mirrors FixtureEditor.vue's 2D overlay -->
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

    <!-- Ctrl/Cmd-drag box-select tool: the rectangle drawn across fixtures — mirrors the 2D canvas's marquee -->
    <svg
      v-if="boxOverlay"
      class="absolute inset-0 w-full h-full pointer-events-none"
    >
      <rect
        :x="Math.min(boxOverlay.x1, boxOverlay.x2)"
        :y="Math.min(boxOverlay.y1, boxOverlay.y2)"
        :width="Math.abs(boxOverlay.x2 - boxOverlay.x1)"
        :height="Math.abs(boxOverlay.y2 - boxOverlay.y1)"
        fill="var(--primary, #3b82f6)"
        fill-opacity="0.1"
        stroke="var(--primary, #3b82f6)"
        stroke-width="1.5"
        stroke-dasharray="4 4"
      />
    </svg>

    <!-- Alignment guides: equal-spacing distance labels, tracking the 3D gap midpoints -->
    <div
      v-for="(label, i) in guideLabels"
      :key="`al-${i}`"
      class="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[11px] font-mono text-white"
      :style="{ left: `${label.x}px`, top: `${label.y}px`, background: '#ff4d9e' }"
    >{{ label.text }}</div>

    <!-- Gizmo mode toggle — styled like the 2D alignment toolbar, but rendered
         as a toggle group (role="radiogroup") since it's a select, not one-shot actions -->
    <div
      v-if="hasFixtureSelection"
      role="radiogroup"
      aria-label="Gizmo mode"
      class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 p-1 rounded-md bg-background/80 backdrop-blur border border-border shadow-sm"
    >
      <Button
        v-for="mode in (['translate', 'rotate'] as const)"
        :key="mode"
        role="radio"
        :aria-checked="gizmoMode === mode"
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :class="gizmoMode === mode ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        :title="mode === 'translate' ? 'Move (G)' : 'Rotate (R)'"
        @click="setGizmoMode(mode)"
      >
        <Move v-if="mode === 'translate'" class="size-4" />
        <RotateCw v-else class="size-4" />
      </Button>
    </div>
  </div>
</template>
