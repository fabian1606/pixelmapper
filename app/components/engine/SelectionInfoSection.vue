```
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useHistory } from './composables/use-history';
import { MoveFixtureCommand, type FixturePositionSnapshot } from './commands/move-fixture-command';
import { RotateFixtureCommand, type FixtureRotationSnapshot } from './commands/rotate-fixture-command';
import { SetModifiersCommand } from './commands/set-modifiers-command';
import { UpdateDmxCommand } from './commands/update-dmx-command';
import SelectionPositionInfo from './SelectionPositionInfo.vue';
import SelectionDmxInfo from './SelectionDmxInfo.vue';
import { useEngineStore } from '~/stores/engine-store';

const props = defineProps<{
  selectedFixtures: Fixture[];
  allFixtures: Fixture[];
}>();

const history = useHistory();
const engineStore = useEngineStore();

// ─── Selection State ──────────────────────────────────────────────────────────

const isSingle = computed(() => props.selectedFixtures.length === 1);
const hasSelection = computed(() => props.selectedFixtures.length > 0);
const firstFixture = computed(() => props.selectedFixtures[0] || null);

// ─── Position Logic ───────────────────────────────────────────────────────────

const avgX = computed(() => {
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + f.fixturePosition.x, 0);
  return sum / props.selectedFixtures.length;
});

const avgY = computed(() => {
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + f.fixturePosition.y, 0);
  return sum / props.selectedFixtures.length;
});

const avgRotation = computed(() => {
  if (!hasSelection.value) return 0;
  const sum = props.selectedFixtures.reduce((acc, f) => acc + (f.rotation || 0), 0);
  return sum / props.selectedFixtures.length;
});

// Snapshots before live movement and the average position at drag start
let dragSnapshotsBefore: FixturePositionSnapshot[] | null = null;
let dragRotationSnapshotsBefore: FixtureRotationSnapshot[] | null = null;
let dragOriginX = 0; // avgX at the start of the interaction (0-1 space)
let dragOriginY = 0;
let dragOriginR = 0; // avgRotation at the start of the interaction

function handleLiveChange(axis: 'x' | 'y' | 'r', value: number) {
  if (axis === 'r') {
    if (!dragRotationSnapshotsBefore) {
      dragOriginR = avgRotation.value;
      dragRotationSnapshotsBefore = props.selectedFixtures.map(f => ({
        id: f.id,
        rotation: f.rotation || 0
      }));
    }

    const deltaR = value - dragOriginR;
    for (const snap of dragRotationSnapshotsBefore) {
      const fixture = props.allFixtures.find(f => f.id === snap.id);
      if (fixture) {
        let newRot = (snap.rotation + deltaR) % 360;
        if (newRot < 0) newRot += 360;
        fixture.rotation = newRot;
      }
    }
    return;
  }

  if (!dragSnapshotsBefore) {
    // Capture initial state before any mutations
    dragOriginX = avgX.value;
    dragOriginY = avgY.value;
    dragSnapshotsBefore = props.selectedFixtures.map(f => ({
      id: f.id,
      x: f.fixturePosition.x,
      y: f.fixturePosition.y,
    }));
  }

  // Delta is always relative to the original position, never to the mutated live state
  const rawDeltaX = axis === 'x' ? value - dragOriginX : 0;
  const rawDeltaY = axis === 'y' ? value - dragOriginY : 0;

  const deltaX = rawDeltaX;
  const deltaY = rawDeltaY;

  // Infinite canvas — no clamping. Apply absolute offsets from the original snapshot positions.
  for (const snap of dragSnapshotsBefore) {
    const fixture = props.allFixtures.find(f => f.id === snap.id);
    if (!fixture) continue;
    if (axis === 'x') {
      fixture.fixturePosition.x = snap.x + deltaX;
    } else {
      fixture.fixturePosition.y = snap.y + deltaY;
    }
  }

  engineStore.triggerCanvasSync();
}

function handlePositionChange(axis: 'x' | 'y' | 'r', _value: number) {
  if (axis === 'r') {
    if (!dragRotationSnapshotsBefore) return;

    const snapshotsAfter: FixtureRotationSnapshot[] = props.allFixtures
      .filter(f => dragRotationSnapshotsBefore!.some(s => s.id === f.id))
      .map(f => ({ id: f.id, rotation: f.rotation || 0 }));

    history.execute(new RotateFixtureCommand(props.allFixtures, dragRotationSnapshotsBefore, snapshotsAfter));
    dragRotationSnapshotsBefore = null;
    return;
  }

  if (!dragSnapshotsBefore) {
    // No live-change happened — this was a direct commit with no preview (shouldn't happen but guard it)
    return;
  }

  // State is already mutated by handleLiveChange. Capture the final positions.
  const snapshotsAfter: FixturePositionSnapshot[] = props.allFixtures
    .filter(f => dragSnapshotsBefore!.some(s => s.id === f.id))
    .map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y }));

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

  history.execute(new UpdateDmxCommand(
    firstFixture.value,
    firstFixture.value.startAddress,
    newGlobalAddress
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
        :avg-rotation="avgRotation"
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
      </template>
    </div>
  </div>
</template>
