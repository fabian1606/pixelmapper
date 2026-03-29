<script setup lang="ts">
import { computed, onMounted, ref, nextTick } from 'vue';
import { Image as ImageIcon } from 'lucide-vue-next';
import { FIXTURE_CATEGORIES, type OflCategory } from '~/utils/engine/custom-fixture-types';

/** Physical scale: 10px per cm. World is 1000×1000cm (10x10m) = 10000×10000px. */
const SCALE = 10; // px per cm
const WORLD_PX = 1000 * SCALE; // 10000
const GRID_PX  = 10 * SCALE;  // 100 — one dot every 10 cm

interface Props {
  fixtureCategory: OflCategory;
  /** Physical width in cm (X axis on canvas). */
  fixtureWidth: number;
  /** Physical height in cm (Y axis on canvas). */
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

const renderMode = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode);

// ─── Derived dimensions in pixels ─────────────────────────────────────────────

const wPx = computed(() => props.fixtureWidth  * SCALE);
const hPx = computed(() => props.fixtureHeight * SCALE);

// For bar/matrix the W×H is the TOTAL fixture footprint.
// Pixel pitch = total size ÷ count.
const pitchX = computed(() => wPx.value / props.pixelColumns);
const pitchY = computed(() => hPx.value / props.pixelRows);

// Convenience aliases (same as wPx/hPx — the total box drawn on canvas)
const barTotalW    = computed(() => wPx.value);
const matrixTotalW = computed(() => wPx.value);
const matrixTotalH = computed(() => hPx.value);

// Centre of the world canvas
const CX = WORLD_PX / 2;
const CY = WORLD_PX / 2;

// ─── Scroll to centre on mount ─────────────────────────────────────────────────
const scrollEl = ref<HTMLElement | null>(null);
const zoom = ref(1.0);

onMounted(() => {
  if (scrollEl.value) {
    scrollEl.value.scrollLeft = CX - scrollEl.value.clientWidth  / 2;
    scrollEl.value.scrollTop  = CY - scrollEl.value.clientHeight / 2;
  }
});

// ─── Panning & Zoom ────────────────────────────────────────────────────────────

function handleWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (!scrollEl.value) return;

    const rect = scrollEl.value.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const oldZoom = zoom.value;
    const zoomFactor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    let newZoom = oldZoom * zoomFactor;
    newZoom = Math.max(0.2, Math.min(3.0, newZoom));

    // Calculate the unscaled canvas point under the mouse
    const pointX = (scrollEl.value.scrollLeft + mouseX) / oldZoom;
    const pointY = (scrollEl.value.scrollTop + mouseY) / oldZoom;

    zoom.value = newZoom;

    // Adjust scroll to keep the unscaled point under the mouse
    nextTick(() => {
      if (scrollEl.value) {
        scrollEl.value.scrollLeft = pointX * newZoom - mouseX;
        scrollEl.value.scrollTop = pointY * newZoom - mouseY;
      }
    });
  }
}

const isPanning = ref(false);
let startX = 0, startY = 0;
let startScrollLeft = 0, startScrollTop = 0;

function handleMouseDown(e: MouseEvent) {
  // Initiating pan anywhere
  isPanning.value = true;
  startX = e.clientX;
  startY = e.clientY;
  if(scrollEl.value) {
    startScrollLeft = scrollEl.value.scrollLeft;
    startScrollTop = scrollEl.value.scrollTop;
  }
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e: MouseEvent) {
  if (!isPanning.value || !scrollEl.value) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  scrollEl.value.scrollLeft = startScrollLeft - dx;
  scrollEl.value.scrollTop = startScrollTop - dy;
}

function handleMouseUp() {
  isPanning.value = false;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
}

// ─── Pixel grid positions ──────────────────────────────────────────────────────

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

/** Pixel circle radius = 78% of the smaller half-pitch. */
const pixelR = computed(() => (Math.min(pitchX.value, renderMode.value === 'bar' ? hPx.value : pitchY.value) / 2) * 0.78);

// ─── Custom SVG ───────────────────────────────────────────────────────────────

const processedSvgData = computed(() => {
  if (!props.customSvgData) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(props.customSvgData, 'image/svg+xml');
    for (const id of props.headSelections) {
      const el = doc.getElementById(id);
      if (el) { el.setAttribute('stroke', '#3b82f6'); el.setAttribute('stroke-width', '2'); }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch { return props.customSvgData; }
});

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
    <!-- Toolbar labels -->
    <div class="absolute top-3 left-3 z-20 pointer-events-none flex gap-2">
      <div class="bg-black/60 backdrop-blur-md rounded-md px-2.5 py-1 border border-white/10 text-[11px] text-white/55 font-medium">
        {{ FIXTURE_CATEGORIES[fixtureCategory].label }} · {{ fixtureWidth }}×{{ fixtureHeight }} cm
      </div>
    </div>

    <!-- Scrollable fixed-size world -->
    <div
      ref="scrollEl"
      class="flex-1 overflow-auto"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab' }"
      @dragover.prevent
      @drop="handleDrop"
      @click="handleCanvasClick"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
    >
      <svg
        :width="WORLD_PX * zoom"
        :height="WORLD_PX * zoom"
        :viewBox="`0 0 ${WORLD_PX} ${WORLD_PX}`"
        class="block"
        xmlns="http://www.w3.org/2000/svg"
        style="background: #080808;"
      >
        <defs>
          <!-- Fine dot grid: every 10 cm -->
          <pattern id="cf-dot-sm" :width="GRID_PX" :height="GRID_PX" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1.2" fill="rgba(255,255,255,0.13)" />
          </pattern>
          <!-- Accent dot grid: every 50 cm -->
          <pattern id="cf-dot-lg" :width="GRID_PX*5" :height="GRID_PX*5" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="2" fill="rgba(255,255,255,0.28)" />
          </pattern>
          <!-- Glow for single head -->
          <radialGradient id="cf-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stop-color="white" stop-opacity="0.18" />
            <stop offset="100%" stop-color="white" stop-opacity="0"    />
          </radialGradient>
        </defs>

        <rect width="100%" height="100%" fill="url(#cf-dot-sm)" />
        <rect width="100%" height="100%" fill="url(#cf-dot-lg)" />

        <!-- Centre crosshair -->
        <line :x1="0"    :y1="CY" :x2="WORLD_PX" :y2="CY" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4 8" />
        <line :x1="CX" :y1="0"    :x2="CX" :y2="WORLD_PX" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4 8" />

        <!-- ── Single head ──────────────────────────────────────────────── -->
        <g v-if="renderMode === 'single'">
          <ellipse :cx="CX" :cy="CY" :rx="wPx/2" :ry="hPx/2" fill="url(#cf-glow)" />
          <ellipse
            :cx="CX" :cy="CY" :rx="wPx/2*0.9" :ry="hPx/2*0.9"
            fill="rgba(255,255,255,0.05)"
            stroke="rgba(255,255,255,0.22)" stroke-width="1.5"
          />
          <circle :cx="CX" :cy="CY" :r="Math.min(wPx,hPx)/2*0.28" fill="rgba(255,255,255,0.5)" />
          <circle :cx="CX" :cy="CY" :r="Math.min(wPx,hPx)/2*0.14" fill="rgba(255,255,255,0.9)" />
        </g>

        <!-- ── Pixel Bar ────────────────────────────────────────────────── -->
        <g v-else-if="renderMode === 'bar'">
          <rect
            :x="CX - barTotalW/2 - 4" :y="CY - hPx/2 - 4"
            :width="barTotalW + 8"     :height="hPx + 8"
            rx="6"
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"
          />
          <circle v-for="(pt,i) in pixels" :key="i" :cx="pt.cx" :cy="pt.cy" :r="pixelR" fill="rgba(255,255,255,0.72)" />
        </g>

        <!-- ── Matrix ──────────────────────────────────────────────────── -->
        <g v-else-if="renderMode === 'matrix'">
          <rect
            :x="CX - matrixTotalW/2 - 4" :y="CY - matrixTotalH/2 - 4"
            :width="matrixTotalW + 8"     :height="matrixTotalH + 8"
            rx="6"
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"
          />
          <circle v-for="(pt,i) in pixels" :key="i" :cx="pt.cx" :cy="pt.cy" :r="pixelR" fill="rgba(255,255,255,0.72)" />
        </g>

        <!-- ── Custom SVG ──────────────────────────────────────────────── -->
        <g v-else-if="renderMode === 'custom_svg' && processedSvgData">
          <foreignObject :x="CX-wPx/2" :y="CY-hPx/2" :width="wPx" :height="hPx">
            <div xmlns="http://www.w3.org/1999/xhtml" class="w-full h-full custom-svg-container" v-html="processedSvgData" />
          </foreignObject>
        </g>
      </svg>
    </div>

    <!-- Custom SVG drag placeholder -->
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

<style>
.custom-svg-container svg { width: 100%; height: 100%; }
.custom-svg-container *:not(svg):hover { outline: 1px dashed rgba(255,255,255,0.4); cursor: pointer; }
</style>
