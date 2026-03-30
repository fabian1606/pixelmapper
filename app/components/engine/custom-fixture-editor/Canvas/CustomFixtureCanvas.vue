<script setup lang="ts">
import { computed } from 'vue';
import { Image as ImageIcon } from 'lucide-vue-next';
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
  customSvgData: string | null;
  headSelections: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'toggleHeadSelection', id: string): void;
  (e: 'uploadSvg', file: File): void;
}>();

const { 
  scrollEl, zoom, isPanning, handleWheel, handleMouseDown 
} = useCanvasInteraction(WORLD_PX);

const renderMode = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode);
const wPx = computed(() => props.fixtureWidth  * SCALE);
const hPx = computed(() => props.fixtureHeight * SCALE);

const pitchX = computed(() => wPx.value / props.pixelColumns);
const pitchY = computed(() => hPx.value / props.pixelRows);

interface Pt { cx: number; cy: number; }

const pixels = computed<Pt[]>(() => {
  const pts: Pt[] = [];
  const rows = renderMode.value === 'bar' ? 1 : props.pixelRows;
  const cols = props.pixelColumns;
  const px = pitchX.value;
  const py = renderMode.value === 'bar' ? hPx.value : pitchY.value;
  const totalW = px * cols;
  const totalH = py * rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        cx: CX - totalW / 2 + px * c + px / 2,
        cy: CY - totalH / 2 + py * r + py / 2,
      });
    }
  }
  return pts;
});

const pixelR = computed(() => (Math.min(pitchX.value, renderMode.value === 'bar' ? hPx.value : pitchY.value) / 2) * 0.78);

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file && file.type === 'image/svg+xml') emit('uploadSvg', file);
}

function handleCanvasClick(event: MouseEvent) {
  if (renderMode.value !== 'custom_svg' || !props.customSvgData) return;
  const target = event.target as SVGElement;
  if (target.tagName.toLowerCase() === 'svg') return;
  if (['path', 'circle', 'rect', 'polygon', 'ellipse', 'g'].includes(target.tagName.toLowerCase())) {
    event.stopPropagation();
    if (!target.id) target.id = 'svg-el-' + Math.random().toString(36).slice(2, 9);
    emit('toggleHeadSelection', target.id);
  }
}
</script>

<template>
  <div class="flex-1 bg-neutral-950 flex flex-col overflow-hidden relative">
    <div class="absolute top-3 left-3 z-20 pointer-events-none flex gap-2">
      <div class="bg-black/60 backdrop-blur-md rounded-md px-2.5 py-1 border border-white/10 text-[11px] text-white/55 font-medium">
        {{ FIXTURE_CATEGORIES[fixtureCategory].label }} · {{ fixtureWidth }}×{{ fixtureHeight }} mm
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

        <CanvasRenderSingle v-if="renderMode === 'single'" :cx="CX" :cy="CY" :w-px="wPx" :h-px="hPx" />
        <CanvasRenderBar v-else-if="renderMode === 'bar'" :cx="CX" :cy="CY" :total-w="wPx" :h-px="hPx" :pixels="pixels" :pixel-r="pixelR" />
        <CanvasRenderMatrix v-else-if="renderMode === 'matrix'" :cx="CX" :cy="CY" :total-w="wPx" :total-h="hPx" :pixels="pixels" :pixel-r="pixelR" />
        <CanvasRenderSvg v-else-if="renderMode === 'custom_svg' && customSvgData" :cx="CX" :cy="CY" :w-px="wPx" :h-px="hPx" :custom-svg-data="customSvgData" :head-selections="headSelections" />
      </svg>
    </div>

    <div
      v-if="renderMode === 'custom_svg' && !customSvgData"
      class="absolute inset-0 flex flex-col items-center justify-center text-white/25 text-sm gap-3 pointer-events-none"
    >
      <ImageIcon class="size-10 opacity-40" />
      <span>Drag &amp; Drop SVG here</span>
      <span class="text-xs opacity-70">or use the import button in the sidebar</span>
    </div>
  </div>
</template>
