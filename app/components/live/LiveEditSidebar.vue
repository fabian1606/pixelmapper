<script setup lang="ts">
import { computed } from 'vue';
import { Play } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { UpdateLivePageCommand } from '~/components/engine/commands/live-widget-commands';
import { getPageResolution } from '~/utils/live/types';

const store = useLiveModeStore();
const history = useHistory();

const ASPECT_RATIOS = [
  { label: '16 : 9',  w: 16, h: 9 },
  { label: '16 : 10', w: 16, h: 10 },
  { label: '4 : 3',   w: 4,  h: 3 },
  { label: '1 : 1',   w: 1,  h: 1 },
  { label: '9 : 16',  w: 9,  h: 16 },
];

const resolution = computed(() => {
  if (!store.activePage) return null;
  return getPageResolution(store.activePage);
});

function setAspectRatio(w: number, h: number) {
  if (!store.activePageId) return;
  history.execute(new UpdateLivePageCommand(store.activePageId, { aspectRatioW: w, aspectRatioH: h }));
}

function setColumns(columns: number) {
  if (!store.activePageId || isNaN(columns) || columns < 4) return;
  history.execute(new UpdateLivePageCommand(store.activePageId, { columns }));
}
</script>

<template>
  <div class="w-56 shrink-0 flex flex-col border-l border-border bg-background">
    <!-- Edit toggle at top -->
    <div class="p-3 border-b border-border">
      <button
        class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
        @click="store.editMode = false"
      >
        <Play class="size-3.5" />
        Play-Modus
      </button>
    </div>

    <!-- Options -->
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
      <div v-if="store.activePage" class="flex flex-col gap-4">

        <!-- Aspect Ratio -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Seitenverhältnis</span>
          <div class="grid grid-cols-1 gap-1">
            <button
              v-for="ar in ASPECT_RATIOS"
              :key="ar.label"
              class="px-2 py-1.5 rounded text-xs font-medium transition-colors text-left"
              :class="store.activePage.aspectRatioW === ar.w && store.activePage.aspectRatioH === ar.h
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
              @click="setAspectRatio(ar.w, ar.h)"
            >
              {{ ar.label }}
            </button>
          </div>
        </div>

        <!-- Columns -->
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Breite (Spalten)</span>
          <input
            type="number"
            :value="store.activePage.columns"
            min="4"
            max="240"
            step="4"
            class="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground"
            @change="(e) => setColumns(Number((e.target as HTMLInputElement).value))"
          />
        </div>

        <!-- Derived resolution display -->
        <div v-if="resolution" class="flex flex-col gap-1 pt-1 border-t border-border">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Berechnete Auflösung</span>
          <span class="text-xs text-foreground font-mono">{{ resolution.w }} × {{ resolution.h }} px</span>
        </div>
      </div>

      <!-- Placeholder for future options -->
      <div class="text-[10px] text-muted-foreground/50 text-center py-2">
        Weitere Optionen folgen
      </div>
    </div>
  </div>
</template>
