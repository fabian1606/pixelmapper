<script setup lang="ts">
import { computed, ref } from 'vue';
import { Image as ImageIcon, CircleHelp } from 'lucide-vue-next';
import { FIXTURE_CATEGORIES, type OflCategory } from '~/utils/engine/custom-fixture-types';
import { useCanvasInteraction } from './useCanvasInteraction';
import CanvasGrid from './CanvasGrid.vue';
import CanvasRenderSingle from './CanvasRenderSingle.vue';
import CanvasRenderBar from './CanvasRenderBar.vue';
import CanvasRenderMatrix from './CanvasRenderMatrix.vue';
import CanvasRenderSvg from './CanvasRenderSvg.vue';

/** Physical scale: 1px per mm (equals 10px per cm). World is 10000×10000mm (10x10m) = 10000×10000px. */
const SCALE = 1; // px per mm
const WORLD_PX = 10000 * SCALE; // 10000
const GRID_PX  = 100 * SCALE;  // 100 — one dot every 100 mm (10 cm)
const CX = WORLD_PX / 2;
const CY = WORLD_PX / 2;

interface Props {
  fixtureCategory: OflCategory;
  fixtureWidth: number;
  fixtureHeight: number;
  pixelColumns: number;
  pixelRows: number;
  headCount: number;
  useCustomSvg: boolean;
  customSvgData: string | null;
  customSvgError: string | null;
  highlightedElementIds: string[];
  activeHeadKey: string;
  headToElementMap: Record<string, string>;
  suggestedMapping?: Record<string, string>;
  hoveredElementId?: string | null;
  hoveredHeadKey?: string | null;
  isPreviewingMapping?: boolean;
  suggestedMappingIds?: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'assignElementToActiveHead', id: string): void;
  (e: 'uploadSvg', file: File): void;
  (e: 'update:useCustomSvg', value: boolean): void;
  (e: 'applySuggestedMapping'): void;
  (e: 'clearSuggestedMapping'): void;
  (e: 'clearSvg'): void;
  (e: 'update:hoveredElementId', value: string | null): void;
}>();

const { 
  scrollEl, zoom, isPanning, handleWheel, handleMouseDown 
} = useCanvasInteraction(WORLD_PX);

const renderMode = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode);
const wPx = computed(() => props.fixtureWidth  * SCALE);
const hPx = computed(() => props.fixtureHeight * SCALE);
const showSvgInfo = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const previewCols = computed(() => {
  if (renderMode.value === 'bar') return Math.max(1, props.headCount);
  if (renderMode.value === 'matrix') return Math.max(1, Math.ceil(Math.sqrt(props.headCount)));
  return Math.max(1, Math.ceil(Math.sqrt(props.headCount)));
});
const previewRows = computed(() => Math.max(1, Math.ceil(props.headCount / previewCols.value)));
const pitchX = computed(() => wPx.value / previewCols.value);
const pitchY = computed(() => hPx.value / previewRows.value);

interface Pt { cx: number; cy: number; }

const pixels = computed<Pt[]>(() => {
  const pts: Pt[] = [];
  const rows = previewRows.value;
  const cols = previewCols.value;
  const px = pitchX.value;
  const py = pitchY.value;
  const totalW = px * cols;
  const totalH = py * rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pts.length >= props.headCount) break;
      pts.push({
        cx: CX - totalW / 2 + px * c + px / 2,
        cy: CY - totalH / 2 + py * r + py / 2,
      });
    }
  }
  return pts;
});

const pixelR = computed(() => (Math.min(pitchX.value, pitchY.value) / 2) * 0.78);

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  const isSvgMime = file.type === 'image/svg+xml';
  const isSvgExt = file.name.toLowerCase().endsWith('.svg');
  if (isSvgMime || isSvgExt) {
    emit('update:useCustomSvg', true);
    emit('uploadSvg', file);
  }
}

function handleFileInputChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  emit('update:useCustomSvg', true);
  emit('uploadSvg', file);
}

function clearSvg() {
  emit('update:useCustomSvg', false);
  emit('clearSuggestedMapping'); // Clear mapped suggestions on removal
  // Setting useCustomSvg back will eventually cause data to clear up above, but let's just trigger upload with empty or handle removing it.
  // Wait, wait... `useCustomFixtureForm` has customSvgData. We can't clear it from here unless we emit it.
  // But wait! If we emit uploadSvg with a special empty file, or emit a clear event. Let's add a clearSvg event.
}

function handleCanvasClick(event: MouseEvent) {
  if (!props.useCustomSvg || !props.customSvgData) return;
  const target = event.target as SVGElement;
  if (target.tagName.toLowerCase() === 'svg') return;
  // Only assign actual drawable shapes, not generic groups/containers.
  if (!['path', 'circle', 'rect', 'polygon', 'ellipse', 'line', 'polyline'].includes(target.tagName.toLowerCase())) return;

  // Exclude invisible / non-painted shapes from assignment.
  const style = window.getComputedStyle(target);
  const hasFill = style.fill !== 'none' && style.fill !== 'transparent';
  const strokeWidth = Number.parseFloat(style.strokeWidth || '0');
  const hasStroke = style.stroke !== 'none' && style.stroke !== 'transparent' && strokeWidth > 0;
  if (!hasFill && !hasStroke) return;

  event.stopPropagation();
  if (!target.id) target.id = 'svg-el-' + Math.random().toString(36).slice(2, 9);
  emit('assignElementToActiveHead', target.id);
}
</script>

<template>
  <div class="flex-1 bg-neutral-950 flex flex-col overflow-hidden relative">
    <div class="absolute top-3 left-3 z-20 flex gap-2 items-start">
      <div class="bg-black/60 backdrop-blur-md rounded-md px-2.5 py-1 border border-white/10 text-[11px] text-white/55 font-medium">
        {{ FIXTURE_CATEGORIES[fixtureCategory].label }} · {{ fixtureWidth }}×{{ fixtureHeight }} mm
      </div>
      <div class="flex items-center bg-black/60 backdrop-blur-md rounded-md p-0.5 border border-white/10 text-[11px] font-medium">
        <button
          type="button"
          class="px-2.5 py-1 rounded-sm transition-colors"
          :class="!useCustomSvg ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'"
          @click="emit('update:useCustomSvg', false)"
        >
          Layout
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-sm transition-colors"
          :class="useCustomSvg ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'"
          @click="emit('update:useCustomSvg', true)"
        >
          Custom Shape
        </button>
      </div>
      <button
        v-if="useCustomSvg && customSvgData"
        type="button"
        class="bg-black/60 backdrop-blur-md rounded-md px-2 py-1 border border-white/10 text-[11px] text-white/80 hover:bg-destructive/20 hover:text-red-400 hover:border-destructive/30 transition-colors"
        @click="emit('clearSvg')"
      >
        Remove SVG
      </button>

      <div class="relative">
        <button
          type="button"
          class="bg-black/60 backdrop-blur-md rounded-md p-1.5 border border-white/10 text-white/70 hover:text-white"
          @mouseenter="showSvgInfo = true"
          @mouseleave="showSvgInfo = false"
        >
          <CircleHelp class="size-3.5" />
        </button>
        <div
          v-if="showSvgInfo"
          class="absolute top-8 left-0 w-72 rounded-md border border-white/15 bg-black/85 p-2 text-[10px] text-white/80 leading-relaxed"
        >
          SVG tips: use visible shapes (`path`, `circle`, `rect`, `polygon`, `ellipse`, `line`, `polyline`), avoid nested groups as targets, keep IDs stable, and include a `viewBox` for reliable scaling.
        </div>
      </div>
    </div>

    <div
      ref="scrollEl"
      class="flex-1 overflow-auto"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab' }"
      @dragover.prevent @drop="handleDrop" @click="handleCanvasClick" @wheel="handleWheel" @mousedown="handleMouseDown"
    >
      <svg
        :width="WORLD_PX * zoom" :height="WORLD_PX * zoom"
        :viewBox="`0 0 ${WORLD_PX} ${WORLD_PX}`"
        class="block" xmlns="http://www.w3.org/2000/svg" style="background: #080808;"
      >
        <CanvasGrid :grid-px="GRID_PX" :world-px="WORLD_PX" :cx="CX" :cy="CY" />

        <CanvasRenderSingle v-if="!useCustomSvg && headCount === 1 && renderMode === 'single'" :cx="CX" :cy="CY" :w-px="wPx" :h-px="hPx" />
        <CanvasRenderBar v-else-if="!useCustomSvg && renderMode === 'bar'" :cx="CX" :cy="CY" :total-w="wPx" :h-px="hPx" :pixels="pixels" :pixel-r="pixelR" />
        <CanvasRenderMatrix v-else-if="!useCustomSvg" :cx="CX" :cy="CY" :total-w="wPx" :total-h="hPx" :pixels="pixels" :pixel-r="pixelR" />
        <CanvasRenderSvg
          v-else-if="useCustomSvg && customSvgData"
          :cx="CX"
          :cy="CY"
          :w-px="wPx"
          :h-px="hPx"
          :custom-svg-data="customSvgData"
          :highlighted-element-ids="highlightedElementIds"
          :active-head-key="activeHeadKey"
          :head-to-element-map="headToElementMap"
          :hovered-element-id="hoveredElementId"
          :hovered-head-key="hoveredHeadKey"
          :is-previewing-mapping="isPreviewingMapping"
          :suggested-mapping-ids="suggestedMappingIds"
          @update:hovered-element-id="emit('update:hoveredElementId', $event)"
          @assign-element-to-active-head="emit('assignElementToActiveHead', $event)"
          :error-message="customSvgError"
        />
      </svg>
    </div>

    <!-- Drag/Drop Dropzone Empty State -->
    <div
      v-if="useCustomSvg && !customSvgData"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px]"
    >
      <label
        class="group flex flex-col items-center justify-center p-12 max-w-md w-full bg-black/80 rounded-2xl border-2 border-dashed border-white/15 hover:border-white/40 hover:bg-white/5 transition-all cursor-pointer"
        :class="{ 'border-primary bg-primary/10 scale-105': isPanning }"
      >
        <div class="size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-white group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-300 mb-6">
           <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
        </div>
        <h3 class="text-white text-lg font-medium tracking-tight mb-2">Upload Custom Shape</h3>
        <p class="text-white/40 text-sm text-center mb-6 max-w-xs leading-relaxed">
          Drag and drop your SVG file here, or click to browse. Ensure it contains identifiable paths for heads.
        </p>
        <div class="px-5 py-2 bg-white/10 text-white text-xs font-semibold rounded-full uppercase tracking-wider group-hover:bg-white/20 transition-colors">
          Select SVG File
        </div>
        <input type="file" accept=".svg,image/svg+xml" class="hidden" @change="handleFileInputChange" />
      </label>
    </div>
  </div>
</template>
