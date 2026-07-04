<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue';
import { X } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import { useSharePatch } from '~/composables/use-share-patch';
import UniversePanel from './UniversePanel.vue';
import AddressGrid from './AddressGrid.vue';
import PatchTable from './PatchTable.vue';
import SharePatchPanel from './SharePatchPanel.vue';
import { LayoutGrid, List, QrCode } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

const props = defineProps<{ active?: boolean }>();

const engineStore = useEngineStore();
const route = useRoute();
const projectId = computed(() => String(route.params.id ?? ''));
const showShare = ref(false);

// Preloaded share link + QR (generated as soon as the table view opens).
const {
  loading: shareLoading,
  error: shareError,
  shareUrl,
  qrDataUrl,
  prepare: prepareShare,
  refresh: refreshShare,
} = useSharePatch(projectId);

const totalUniverses = computed(() => engineStore.totalUniverses);
const universes = computed(() => Array.from({ length: totalUniverses.value }, (_, i) => i + 1));

const selectedUniverse = ref(1);
const addressGridRef = ref<InstanceType<typeof AddressGrid> | null>(null);
const universePanelRef = ref<InstanceType<typeof UniversePanel> | null>(null);

const viewMode = ref<'grid' | 'table'>('grid');

// ── Floating share button visibility ──────────────────────────────────────
// The FAB shows only while the table is scrolled to the very top. Scrolling
// away hides it immediately; returning to the top shows it again after a 5s
// dwell (immediate on the first arrival at the top).
const patchTableRef = ref<InstanceType<typeof PatchTable> | null>(null);
const showFab = ref(false);
let scrollEl: HTMLElement | null = null;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;
let scrolledAway = false;

function clearDwell() {
  if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
}

function onTableScroll() {
  const atTop = !scrollEl || scrollEl.scrollTop <= 4;
  if (!atTop) {
    scrolledAway = true;
    showFab.value = false;
    clearDwell();
    return;
  }
  if (showFab.value) return;
  if (!scrolledAway) { showFab.value = true; return; } // first arrival: immediate
  clearDwell();
  dwellTimer = setTimeout(() => {
    if (!scrollEl || scrollEl.scrollTop <= 4) showFab.value = true;
  }, 2000);
}

function unbindScroll() {
  if (scrollEl) { scrollEl.removeEventListener('scroll', onTableScroll); scrollEl = null; }
  clearDwell();
}

function bindScroll() {
  unbindScroll();
  const root = patchTableRef.value?.$el as HTMLElement | undefined;
  scrollEl = root?.querySelector('[data-slot="scroll-area-viewport"]') ?? null;
  scrolledAway = false;
  showFab.value = !scrollEl || scrollEl.scrollTop <= 4;
  scrollEl?.addEventListener('scroll', onTableScroll, { passive: true });
}

watch(viewMode, async (mode) => {
  if (mode === 'table') {
    await nextTick();
    bindScroll();
    if (projectId.value) prepareShare();
  } else {
    unbindScroll();
    showFab.value = false;
    showShare.value = false;
  }
}, { immediate: true });

onUnmounted(unbindScroll);

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
      <div class="flex items-center gap-1.5">
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
      <!-- Table view: patch table + inline QR share panel + floating button.
           @container so the panel sits to the RIGHT by default and only stacks
           ABOVE the table when the panel gets too narrow (@max-lg). -->
      <div
        v-if="viewMode === 'table'"
        class="@container flex-1 min-h-0 flex flex-row @max-lg:flex-col overflow-hidden relative"
      >
        <PatchTable ref="patchTableRef" class="flex-1 min-w-0 min-h-0" />
        <SharePatchPanel
          v-if="projectId && showShare"
          :loading="shareLoading"
          :error="shareError"
          :share-url="shareUrl"
          :qr-data-url="qrDataUrl"
          class="shrink-0 w-60 border-l border-border/40
                 @max-lg:w-full @max-lg:order-first @max-lg:border-l-0 @max-lg:border-b"
          @close="showShare = false"
          @refresh="refreshShare"
        />

        <!-- Floating share button (only at the very top of the table) -->
        <Transition
          enter-active-class="transition-opacity duration-300"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition-opacity duration-200"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <Button
            v-if="projectId && showFab && !showShare"
            variant="default"
            size="icon"
            class="absolute bottom-4 right-4 z-20 rounded-full shadow-lg"
            title="Patch aufs Handy teilen (QR)"
            @click="showShare = true"
          >
            <QrCode class="w-4 h-4" />
          </Button>
        </Transition>
      </div>
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
