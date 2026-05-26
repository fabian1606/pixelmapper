<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SpeedCurveParams, CurvePoint, SpeedConfig } from '~/utils/engine/types';
import { sampleCurve, CURVE_PRESETS } from '~/utils/engine/effects/curve-math';

const props = defineProps<{
  params: SpeedCurveParams;
  speed?: SpeedConfig;
}>();

const emit = defineEmits<{
  (e: 'update:params', params: SpeedCurveParams): void;
  (e: 'change-end'): void;
}>();

// ─── SVG dimensions (matches WaveformEditor) ──────────────────────────────────
const SVG_W = 240;
const SVG_H = 72;
const PAD_Y = 6;

const svgRef = ref<SVGSVGElement | null>(null);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const points = computed(() => props.params.points);
const maxMult = computed(() => props.params.maxMultiplier ?? 4);
const cycleBeats = computed(() => props.params.cycleBeats ?? 1);

// ─── Coordinate helpers ───────────────────────────────────────────────────────
// y=0 → top (high multiplier), y=SVG_H → bottom (0 multiplier)
function toSvgY(y: number): number {
  return SVG_H - PAD_Y - (y / maxMult.value) * (SVG_H - 2 * PAD_Y);
}
function fromSvgY(ry: number): number {
  return clamp((1 - ry) * maxMult.value, 0, maxMult.value);
}

// ─── Snap positions (beat-aligned) ───────────────────────────────────────────
const snapPositions = computed((): number[] => {
  const count = cycleBeats.value * 8; // 8 sub-ticks per beat
  return Array.from({ length: count + 1 }, (_, i) => i / count);
});

function snapX(x: number): number {
  const snaps = snapPositions.value;
  if (snaps.length < 2) return x;
  const interval = snaps[1]! - snaps[0]!;
  const threshold = interval * 0.35;
  for (const s of snaps) {
    if (Math.abs(x - s) < threshold) return s;
  }
  return x;
}

// ─── Curve polyline ───────────────────────────────────────────────────────────
const curvePoints = computed(() => {
  const pts: string[] = [];
  const samples = 120;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const y = sampleCurve(points.value, t);
    pts.push(`${(t * SVG_W).toFixed(1)},${toSvgY(y).toFixed(1)}`);
  }
  return pts.join(' ');
});

// ─── Y=1 reference line ───────────────────────────────────────────────────────
const refLineY = computed(() => toSvgY(1));

// ─── Beat-grid lines ──────────────────────────────────────────────────────────
const beatLinePositions = computed((): number[] => {
  if (cycleBeats.value <= 1) return [];
  return Array.from({ length: cycleBeats.value - 1 }, (_, i) => (i + 1) / cycleBeats.value);
});

// ─── Generic drag utility (copied from WaveformEditor) ───────────────────────
function startDrag(
  e: MouseEvent,
  onMove: (rx: number, ry: number) => void,
  onEnd?: () => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const move = (me: MouseEvent) => {
    if (!svgRef.value) return;
    const rect = svgRef.value.getBoundingClientRect();
    const rx = clamp((me.clientX - rect.left) / rect.width, 0, 1);
    const ry = clamp((me.clientY - rect.top) / rect.height, 0, 1);
    onMove(rx, ry);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    emit('change-end');
    onEnd?.();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ─── Control-point drag ───────────────────────────────────────────────────────
function onPointDrag(e: MouseEvent, idx: number) {
  const isEnd = idx === 0 || idx === points.value.length - 1;
  startDrag(e, (rx, ry) => {
    const newY = fromSvgY(ry);
    const pts = props.params.points.map((p, i) => {
      if (i !== idx) return p;
      if (isEnd) return { x: p.x, y: Math.round(newY * 100) / 100 };
      // Inner point: x clamped between neighbours, y free
      const minX = props.params.points[idx - 1]!.x + 0.02;
      const maxX = props.params.points[idx + 1]!.x - 0.02;
      const newX = snapX(clamp(rx, minX, maxX));
      return { x: Math.round(newX * 1000) / 1000, y: Math.round(newY * 100) / 100 };
    });
    emit('update:params', { ...props.params, points: pts });
  });
}

// ─── Click on SVG background → add point ─────────────────────────────────────
function onSvgClick(e: MouseEvent) {
  if (!svgRef.value) return;
  const rect = svgRef.value.getBoundingClientRect();
  const rx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const ry = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  // Don't add if clicked near an existing point
  for (const p of points.value) {
    if (Math.abs(p.x - rx) < 0.04) return;
  }
  const snapped = snapX(rx);
  const newY = fromSvgY(ry);
  const newPt: CurvePoint = { x: Math.round(snapped * 1000) / 1000, y: Math.round(newY * 100) / 100 };
  const pts = [...props.params.points, newPt].sort((a, b) => a.x - b.x);
  emit('update:params', { ...props.params, points: pts });
  emit('change-end');
}

// ─── Double-click on inner point → remove ────────────────────────────────────
function onPointDblClick(e: MouseEvent, idx: number) {
  e.stopPropagation();
  if (idx === 0 || idx === points.value.length - 1) return; // Never remove endpoints
  const pts = props.params.points.filter((_, i) => i !== idx);
  emit('update:params', { ...props.params, points: pts });
  emit('change-end');
}

// ─── Preset selection ─────────────────────────────────────────────────────────
function applyPreset(preset: typeof CURVE_PRESETS[0]) {
  emit('update:params', { ...props.params, points: preset.points.map(p => ({ ...p })) });
  emit('change-end');
}

function reset() {
  emit('update:params', { ...props.params, points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] });
  emit('change-end');
}

function setCycleBeats(beats: 1 | 2 | 4 | 8) {
  emit('update:params', { ...props.params, cycleBeats: beats });
  emit('change-end');
}

function setMaxMult(v: number) {
  emit('update:params', { ...props.params, maxMultiplier: v });
  emit('change-end');
}
</script>

<template>
  <div class="space-y-2">
    <!-- Preset buttons row -->
    <div class="flex gap-1 flex-wrap">
      <button
        v-for="preset in CURVE_PRESETS"
        :key="preset.label"
        class="px-1.5 py-0.5 rounded border text-[9px] font-medium transition-all border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </button>
    </div>

    <!-- Main curve editor SVG -->
    <div class="rounded-md border border-border/60 bg-muted/10 overflow-hidden">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
        preserveAspectRatio="none"
        class="w-full block"
        :style="{ height: '80px' }"
        @click="onSvgClick"
        @mousedown.prevent
      >
        <!-- Grid lines (subtle) -->
        <line
          v-for="n in [0.25, 0.5, 0.75]"
          :key="n"
          :x1="n * SVG_W" :y1="PAD_Y" :x2="n * SVG_W" :y2="SVG_H - PAD_Y"
          stroke="white" stroke-opacity="0.06" stroke-width="1"
        />

        <!-- Beat-division vertical lines -->
        <line
          v-for="pos in beatLinePositions"
          :key="pos"
          :x1="pos * SVG_W" :y1="PAD_Y" :x2="pos * SVG_W" :y2="SVG_H - PAD_Y"
          stroke="#f97316" stroke-opacity="0.2" stroke-width="1" stroke-dasharray="3 3"
        />

        <!-- Snap ticks at the bottom -->
        <line
          v-for="snap in snapPositions"
          :key="snap"
          :x1="snap * SVG_W" :y1="SVG_H - 3" :x2="snap * SVG_W" :y2="SVG_H"
          stroke="white" stroke-opacity="0.2" stroke-width="1"
        />

        <!-- y=1 reference line (no change line) -->
        <line
          :x1="0" :y1="refLineY" :x2="SVG_W" :y2="refLineY"
          stroke="white" stroke-opacity="0.15" stroke-width="1"
        />

        <!-- Curve polyline -->
        <polyline
          :points="curvePoints"
          fill="none"
          stroke="#f97316"
          stroke-opacity="0.9"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- Control points -->
        <circle
          v-for="(pt, idx) in points"
          :key="idx"
          :cx="pt.x * SVG_W"
          :cy="toSvgY(pt.y)"
          r="5"
          fill="#f97316"
          stroke="rgba(0,0,0,0.6)"
          stroke-width="1.5"
          :style="{ cursor: idx === 0 || idx === points.length - 1 ? 'ns-resize' : 'move' }"
          @mousedown.stop="onPointDrag($event, idx)"
          @dblclick.stop="onPointDblClick($event, idx)"
        />
      </svg>
    </div>

    <!-- Controls row -->
    <div class="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
      <!-- Cycle beats -->
      <div class="flex items-center gap-1">
        <span class="text-[10px]">Cycle</span>
        <div class="flex gap-0.5">
          <button
            v-for="b in [1, 2, 4, 8] as const"
            :key="b"
            class="px-1.5 py-0.5 rounded border text-[9px] transition-all"
            :class="cycleBeats === b
              ? 'border-orange-500/60 bg-orange-500/10 text-orange-400'
              : 'border-border/40 text-muted-foreground hover:border-muted-foreground/40'"
            @click="setCycleBeats(b)"
          >
            {{ b }}B
          </button>
        </div>
      </div>

      <!-- Max multiplier -->
      <div class="flex items-center gap-1 flex-1">
        <span class="text-[10px] shrink-0">Max ×{{ maxMult }}</span>
        <input
          type="range"
          min="1" max="8" step="0.5"
          :value="maxMult"
          class="flex-1 h-1 accent-orange-500"
          @input="setMaxMult(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <!-- Reset -->
      <button
        class="px-1.5 py-0.5 rounded border border-border/40 text-[9px] text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30 transition-all"
        @click="reset"
      >
        Reset
      </button>
    </div>

    <p class="text-[9px] text-muted-foreground/60">Click to add points · Double-click to remove</p>
  </div>
</template>
