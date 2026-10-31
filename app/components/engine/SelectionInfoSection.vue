<script setup lang="ts">
import { getKind } from '~/utils/kinds/kind-host';
import { computed, ref, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useHistory } from './composables/use-history';
import { MoveFixtureCommand, type FixturePositionSnapshot } from './commands/move-fixture-command';
import { RotateFixtureCommand, type FixtureRotationSnapshot } from './commands/rotate-fixture-command';
import { SetModifiersCommand } from './commands/set-modifiers-command';
import { UpdateDmxCommand } from './commands/update-dmx-command';
import SelectionPositionInfo, { type PositionAxis } from './SelectionPositionInfo.vue';
import SelectionDmxInfo from './SelectionDmxInfo.vue';
import KindConfigSection from './KindConfigSection.vue';
import { useEngineStore } from '~/stores/engine-store';
import { applyRotationDelta, collectRotationTargets, type RotationTarget } from '~/utils/engine/group-rotation';
import { storeToRefs } from 'pinia';

const props = defineProps<{
  selectedFixtures: Fixture[];
  allFixtures: Fixture[];
  /** Raw selection (may hold group ids) — decides whether rotation turns whole groups. */
  selectedIds: Set<string | number>;
}>();

const history = useHistory();
const engineStore = useEngineStore();
const { layoutRevision } = storeToRefs(engineStore);

// ─── Selection State ──────────────────────────────────────────────────────────

const isSingle = computed(() => props.selectedFixtures.length === 1);
const hasSelection = computed(() => props.selectedFixtures.length > 0);
const firstFixture = computed(() => props.selectedFixtures[0] || null);

// ─── Position Logic ───────────────────────────────────────────────────────────
//
// Fixture position/rotation fields are plain (non-reactive) — mutated directly
// during drags for performance (see engine-store.ts's rebuildLayoutAndChannels
// comment). Reading layoutRevision.value here — bumped every drag frame by
// triggerCanvasSync() — re-runs these computeds so the panel stays live.

const avgX = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + f.fixturePosition.x, 0);
  return sum / props.selectedFixtures.length;
});

const avgY = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + f.fixturePosition.y, 0);
  return sum / props.selectedFixtures.length;
});

const avgZ = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + (f.positionZ || 0), 0);
  return sum / props.selectedFixtures.length;
});

const avgRotation = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + (f.rotation || 0), 0);
  return sum / props.selectedFixtures.length;
});

const avgTiltX = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + (f.tiltX || 0), 0);
  return sum / props.selectedFixtures.length;
});

const avgRollZ = computed(() => {
  void layoutRevision.value;
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + (f.rollZ || 0), 0);
  return sum / props.selectedFixtures.length;
});

// Snapshots before live movement and the average position at drag start
let dragSnapshotsBefore: FixturePositionSnapshot[] | null = null;
let dragRotationSnapshotsBefore: FixtureRotationSnapshot[] | null = null;
// Start state for the 'r' axis: selected groups orbit their center.
let dragRotationTargets: Map<string | number, RotationTarget> | null = null;
let dragOriginX = 0; // avgX at the start of the interaction (0-1 space)
let dragOriginY = 0;
let dragOriginZ = 0;
let dragOriginR = 0; // avgRotation at the start of the interaction
let dragOriginTX = 0;
let dragOriginRZ = 0;

const isRotationAxis = (axis: PositionAxis) => axis === 'r' || axis === 'tx' || axis === 'rz';

function handleLiveChange(axis: PositionAxis, value: number) {
  if (isRotationAxis(axis)) {
    if (!dragRotationSnapshotsBefore) {
      dragOriginR = avgRotation.value;
      dragOriginTX = avgTiltX.value;
      dragOriginRZ = avgRollZ.value;
      dragRotationTargets = new Map(
        collectRotationTargets(props.selectedFixtures, props.selectedIds).map(t => [t.id, t]),
      );
      dragRotationSnapshotsBefore = props.selectedFixtures.map((f) => {
        const snap: FixtureRotationSnapshot = {
          id: f.id,
          rotation: f.rotation || 0,
          tiltX: f.tiltX || 0,
          rollZ: f.rollZ || 0,
        };
        // Group members also move — record their position for undo.
        if (axis === 'r' && dragRotationTargets?.get(f.id)?.pivot) {
          snap.x = f.fixturePosition.x;
          snap.y = f.fixturePosition.y;
        }
        return snap;
      });
    }

    const origin = axis === 'r' ? dragOriginR : axis === 'tx' ? dragOriginTX : dragOriginRZ;
    const delta = value - origin;
    const wrap = (v: number) => {
      let w = v % 360;
      if (w < 0) w += 360;
      return w;
    };
    for (const snap of dragRotationSnapshotsBefore) {
      const fixture = props.allFixtures.find(f => f.id === snap.id);
      if (!fixture) continue;
      const target = dragRotationTargets?.get(snap.id);
      if (axis === 'r' && target) applyRotationDelta(fixture, target, delta);
      else if (axis === 'r') fixture.rotation = wrap(snap.rotation + delta);
      else if (axis === 'tx') fixture.tiltX = wrap((snap.tiltX ?? 0) + delta);
      else fixture.rollZ = wrap((snap.rollZ ?? 0) + delta);
    }
    engineStore.triggerCanvasSync();
    return;
  }

  if (!dragSnapshotsBefore) {
    // Capture initial state before any mutations
    dragOriginX = avgX.value;
    dragOriginY = avgY.value;
    dragOriginZ = avgZ.value;
    dragSnapshotsBefore = props.selectedFixtures.map(f => ({
      id: f.id,
      x: f.fixturePosition.x,
      y: f.fixturePosition.y,
      z: f.positionZ || 0,
    }));
  }

  // Delta is always relative to the original position, never to the mutated live state
  const origin = axis === 'x' ? dragOriginX : axis === 'y' ? dragOriginY : dragOriginZ;
  const delta = value - origin;

  // Infinite canvas — no clamping on x/y. Height stays at or above the floor.
  for (const snap of dragSnapshotsBefore) {
    const fixture = props.allFixtures.find(f => f.id === snap.id);
    if (!fixture) continue;
    if (axis === 'x') {
      fixture.fixturePosition.x = snap.x + delta;
    } else if (axis === 'y') {
      fixture.fixturePosition.y = snap.y + delta;
    } else {
      fixture.positionZ = Math.max(0, (snap.z ?? 0) + delta);
    }
  }

  engineStore.triggerCanvasSync();
}

function handlePositionChange(axis: PositionAxis, _value: number) {
  if (isRotationAxis(axis)) {
    if (!dragRotationSnapshotsBefore) return;

    const snapshotsAfter: FixtureRotationSnapshot[] = props.allFixtures
      .filter(f => dragRotationSnapshotsBefore!.some(s => s.id === f.id))
      .map((f) => {
        const snap: FixtureRotationSnapshot = { id: f.id, rotation: f.rotation || 0, tiltX: f.tiltX || 0, rollZ: f.rollZ || 0 };
        if (dragRotationSnapshotsBefore!.find(s => s.id === f.id)?.x !== undefined) {
          snap.x = f.fixturePosition.x;
          snap.y = f.fixturePosition.y;
        }
        return snap;
      });

    history.execute(new RotateFixtureCommand(props.allFixtures, dragRotationSnapshotsBefore, snapshotsAfter));
    dragRotationSnapshotsBefore = null;
    dragRotationTargets = null;
    return;
  }

  if (!dragSnapshotsBefore) {
    // No live-change happened — this was a direct commit with no preview (shouldn't happen but guard it)
    return;
  }

  // State is already mutated by handleLiveChange. Capture the final positions.
  const snapshotsAfter: FixturePositionSnapshot[] = props.allFixtures
    .filter(f => dragSnapshotsBefore!.some(s => s.id === f.id))
    .map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ || 0 }));

  history.execute(new MoveFixtureCommand(props.allFixtures, dragSnapshotsBefore, snapshotsAfter));
  dragSnapshotsBefore = null;
}

// ─── DMX Logic ────────────────────────────────────────────────────────────────

const localAddress = ref(1);
const universe = ref(1);

watch(firstFixture, (fix) => {
  if (fix) {
    localAddress.value = fix.localAddress;
    universe.value = fix.universe;
  }
}, { immediate: true });

function updateDmx() {
  if (!firstFixture.value) return;

  const newGlobalAddress = ((universe.value - 1) * 512) + localAddress.value;
  if (newGlobalAddress === firstFixture.value.startAddress) return;
  if (newGlobalAddress < 1 || newGlobalAddress > 16384) return;

  // Reject if the fixture would extend beyond the 512-channel universe
  // boundary — unless its kind declares `spansUniverses` (e.g. pixel strips
  // fed as one buffer).
  const kind = firstFixture.value.kind ? getKind(firstFixture.value.kind.id) : undefined;
  if (!kind?.def.spansUniverses) {
    const localStart = ((newGlobalAddress - 1) % 512) + 1;
    if (localStart + firstFixture.value.channels.length - 1 > 512) return;
  }

  history.execute(new UpdateDmxCommand(
    firstFixture.value,
    firstFixture.value.startAddress,
    newGlobalAddress,
  ));
}

</script>

<template>
  <div 
    class="border-t border-border bg-sidebar/50 flex flex-col transition-opacity duration-200"
    :class="{ 'opacity-40 grayscale pointer-events-none select-none': !hasSelection }"
  >
    <!-- Header -->
    <div class="h-12 flex items-center px-4 border-b border-border/50 bg-background/20 overflow-hidden">
      <span class="font-semibold text-xs tracking-wider uppercase text-muted-foreground">
        <template v-if="isSingle && firstFixture">
          {{ firstFixture.manufacturer || 'Generic' }} - {{ firstFixture.fixtureType }}
        </template>
        <template v-else>
          Selection
        </template>
      </span>
      <span v-if="selectedFixtures.length > 1" class="ml-auto text-[9px] tabular-nums font-medium text-muted-foreground/50 shrink-0">
        {{ selectedFixtures.length }}
      </span>
    </div>

    <!-- Content -->
    <div class="px-3 py-5 space-y-6">
      
      <!-- Position Section -->
      <SelectionPositionInfo
        :avg-x="avgX"
        :avg-y="avgY"
        :avg-z="avgZ"
        :avg-rotation="avgRotation"
        :avg-tilt-x="avgTiltX"
        :avg-roll-z="avgRollZ"
        @live-change="handleLiveChange"
        @change="handlePositionChange"
      />

      <!-- Single Selection Details -->
      <template v-if="isSingle && firstFixture">
        <div class="pt-2 border-t border-border/30">
          <SelectionDmxInfo 
            v-model:universe="universe"
            v-model:local-address="localAddress"
            :fixture-count="firstFixture.channels.length"
            @change-universe="updateDmx"
            @change-address="updateDmx"
          />
        </div>
        <!-- Fixture-kind config (e.g. strip LEDs, chip, shape) -->
        <div v-if="firstFixture.kind" class="pt-2 border-t border-border/30">
          <KindConfigSection :fixture="firstFixture" />
        </div>
      </template>
    </div>
  </div>
</template>
