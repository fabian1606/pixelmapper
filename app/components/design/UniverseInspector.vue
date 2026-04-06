<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { X } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import UniversePanel from './UniversePanel.vue';
import AddressGrid from './AddressGrid.vue';
import PatchTable from './PatchTable.vue';
import { LayoutGrid, List } from 'lucide-vue-next';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

const props = defineProps<{ active?: boolean }>();

const engineStore = useEngineStore();

const totalUniverses = computed(() => engineStore.totalUniverses);
const universes = computed(() => Array.from({ length: totalUniverses.value }, (_, i) => i + 1));

const selectedUniverse = ref(1);
const addressGridRef = ref<InstanceType<typeof AddressGrid> | null>(null);
const universePanelRef = ref<InstanceType<typeof UniversePanel> | null>(null);

const viewMode = ref<'grid' | 'table'>('grid');

// Keep selectedUniverse in range if totalUniverses shrinks
watch(totalUniverses, (total) => {
  if (selectedUniverse.value > total && total > 0) {
    selectedUniverse.value = 1;
  }
});

// When grid scrolls to a different universe, update dropdown
function onVisibleUniverseChange(universe: number) {
  if (universe !== selectedUniverse.value && universe >= 1 && universe <= totalUniverses.value) {
    selectedUniverse.value = universe;
  }
}

// When dropdown changes, scroll grid to that universe
watch(selectedUniverse, (u) => {
  addressGridRef.value?.scrollToUniverse(u);
});

// When selection changes, switch to the selected fixture's universe and scroll faders
watch(() => engineStore.selectedIds, (ids) => {
  if (ids.size === 0) return;
  const firstId = ids.values().next().value;
  const fixture = engineStore.flatFixtures.find(f => f.id === firstId);
  if (!fixture) return;
  if (fixture.universe !== selectedUniverse.value) {
    selectedUniverse.value = fixture.universe;
  }
  // Scroll faders to the fixture's first channel
  nextTick(() => {
    const bufIdx = (fixture.universe - 1) * 512 + fixture.localAddress - 1;
    universePanelRef.value?.scrollToChannel(bufIdx);
  });
});

const hasAnyOverride = computed(() => (engineStore.overrideMap?.size ?? 0) > 0);
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 bg-background">
    <!-- Global Inspector Header (View Switcher) -->
    <div class="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
      <h2 class="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">Address Patch</h2>
      <Tabs v-model="viewMode" class="w-auto">
        <TabsList class="h-7 p-0.5 bg-background/50 border border-border/20">
          <TabsTrigger value="grid" class="h-6 px-2.5 text-[10px] gap-1.5 data-[state=active]:text-amber-500 transition-all">
            <LayoutGrid class="w-3 h-3" />
            Grid
          </TabsTrigger>
          <TabsTrigger value="table" class="h-6 px-2.5 text-[10px] gap-1.5 data-[state=active]:text-amber-500 transition-all">
            <List class="w-3 h-3" />
            Table
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <!-- Address patching area (fills everything above the faders) -->
    <div class="flex-1 min-h-0 relative flex flex-col overflow-hidden">
      <AddressGrid 
        v-show="viewMode === 'grid'"
        ref="addressGridRef" 
        class="flex-1" 
        :active="props.active" 
        @update:visible-universe="onVisibleUniverseChange" 
      />
      <PatchTable 
        v-if="viewMode === 'table'"
        class="flex-1"
      />
    </div>

    <!-- Fixed-height bottom panel: universe selector + faders -->
    <div style="height: 380px; flex-shrink: 0;" class="flex flex-col min-w-0 border-t border-border/40">
      <!-- Universe selector header -->
      <div class="flex items-center gap-2 px-4 py-2 border-b border-border/40 shrink-0">
        <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Universe</span>
        <select
          v-model="selectedUniverse"
          class="flex-1 rounded border border-border bg-background text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option v-for="u in universes" :key="u" :value="u">U{{ u }}</option>
        </select>
        <button
          v-if="hasAnyOverride"
          class="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 transition-colors shrink-0"
          title="Alle Overrides entfernen"
          @click="engineStore.clearAllOverrides()"
        >
          <X class="w-3 h-3" />
          Clear all
        </button>
      </div>

      <!-- Fader panel fills the rest of the 380px wrapper -->
      <UniversePanel
        v-if="totalUniverses > 0"
        ref="universePanelRef"
        :key="selectedUniverse"
        :universe="selectedUniverse"
        :active="props.active"
        :default-expanded="true"
        class="flex-1 min-h-0 "
      />
      <div v-else class="flex-1 flex items-center justify-center text-xs text-muted-foreground/40">
        Keine Universen konfiguriert
      </div>
    </div>
  </div>
</template>
