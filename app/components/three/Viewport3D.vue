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
import type { GizmoMode, ThreeSceneManager, TransformDelta } from './scene/three-scene-manager';

const props = defineProps<{ active: boolean }>();

const engineStore = useEngineStore();
const { selectedIds, layoutRevision, flatFixtures } = storeToRefs(engineStore);
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
// its outermost group, repeated quick clicks step one level deeper.
let lastClickId: string | number | null = null;
let lastClickTime = 0;

function handleSelect(id: string | number | null, additive: boolean) {
  if (id === null) {
    if (!additive) selectedIds.value = new Set();
    return;
  }

  const fixture = flatFixtures.value.find(f => f.id === id);
  let targetId = id;

  if (fixture) {
    const now = performance.now();
    const isDoubleClick = lastClickId === fixture.id && now - lastClickTime < 300;
    lastClickId = fixture.id;
    lastClickTime = now;

    const path: SceneNode[] = [];
    let curr: SceneNode | null = fixture as unknown as SceneNode;
    while (curr) { path.unshift(curr); curr = curr.parent; }

    let targetNode = path[0];
    const selectedIndex = path.findIndex(n => selectedIds.value.has(n.id));
    if (selectedIndex !== -1) {
      if (isDoubleClick && selectedIndex < path.length - 1) {
        targetNode = path[selectedIndex + 1] as SceneNode;
        lastClickId = null;
      } else {
        targetNode = path[selectedIndex] as SceneNode;
      }
    }
    if (targetNode) targetId = targetNode.id;
  }

  if (additive) {
    const next = new Set(selectedIds.value);
    next.has(targetId) ? next.delete(targetId) : next.add(targetId);
    selectedIds.value = next;
  } else {
    selectedIds.value = new Set([targetId]);
  }
}

// ── Gizmo drags → store mutations + one history command per drag ──────────────

let dragPositionsBefore: FixturePositionSnapshot[] | null = null;
let dragRotationsBefore: FixtureRotationSnapshot[] | null = null;

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
}

const wrapDeg = (v: number) => {
  let w = v % 360;
  if (w < 0) w += 360;
  return w;
};

function handleDragMove(mode: GizmoMode, delta: TransformDelta) {
  if (mode === 'translate' && dragPositionsBefore) {
    const dragged: Array<{ id: string | number; x: number; y: number; z: number }> = [];
    for (const snap of dragPositionsBefore) {
      const f = flatFixtures.value.find(x => x.id === snap.id);
      if (!f) continue;
      // World meters → normalized stage fractions (x→X, y→Z, height→Y).
      f.fixturePosition.x = snap.x + delta.position.x / STAGE_SIZE_METERS;
      f.fixturePosition.y = snap.y + delta.position.z / STAGE_SIZE_METERS;
      f.positionZ = Math.max(0, (snap.z ?? 0) + delta.position.y / STAGE_SIZE_METERS);
      dragged.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ });
    }
    if (dragged.length > 0) liveBus.dispatch('fixture.drag', { fixtures: dragged });
  } else if (mode === 'rotate' && dragRotationsBefore) {
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
