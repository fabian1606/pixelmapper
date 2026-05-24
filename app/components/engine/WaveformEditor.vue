<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WaveformShape, WaveformShapeParams, SpeedConfig } from '~/utils/engine/types';
import {
  evaluateShape,
  evaluatePhase,
  shapeLabel,
  ALL_WAVEFORM_SHAPES,
  pointsToSvgString,
  sampleWaveform,
} from '~/utils/engine/effects/waveform-math';

const props = defineProps<{
  shape: WaveformShape;
  params: WaveformShapeParams;
  strength: number;
  speed?: SpeedConfig;
}>();

const emit = defineEmits<{
  (e: 'update:shape', shape: WaveformShape): void;
  (e: 'update:params', params: WaveformShapeParams): void;
  (e: 'update:strength', strength: number): void;
  (e: 'change-end'): void;
}>();

// ─── SVG dimensions ───────────────────────────────────────────────────────────
const SVG_W = 240;
const SVG_H = 72;
const MINI_W = 44;
const MINI_H = 18;
const PAD_Y = 6;
const WAVE_AMP = SVG_H / 2 - PAD_Y; // max amplitude in SVG units

const TAU = Math.PI * 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const svgRef = ref<SVGSVGElement | null>(null);

const start = computed(() => props.params.start);
const end = computed(() => props.params.end);
const scale = computed(() => props.strength / 100);
const offset = computed(() => props.params.offset ?? 0);
// Floor handle: explicit inactive-zone level (0..1, fraction of base color).
// undefined / negative = disabled (legacy offset-based behavior).
const floorRaw = computed(() => props.params.floor);
const floorActive = computed(() => floorRaw.value !== undefined && floorRaw.value >= 0);
const floor = computed(() => floorActive.value ? clamp(floorRaw.value!, 0, 1) : 0.5);

// Floor handle visual position: y=0 → floor=1 (top, full color), y=SVG_H → floor=0 (black).
const floorHandleY = computed(() => SVG_H * (1 - floor.value));

// ─── Snap positions based on speed config ────────────────────────────────────
const snapPositions = computed((): number[] => {
  if (!props.speed) return [];
  let count: number;
  if (props.speed.mode === 'beat') {
    count = 8;
  } else {
    // time mode: 0.25s steps for ≤2s, 0.5s steps for >2s
    const snapMs = props.speed.timeMs <= 2000 ? 250 : 500;
    count = Math.max(2, Math.round(props.speed.timeMs / snapMs));
  }
  return Array.from({ length: count + 1 }, (_, i) => i / count);
});

function snapValue(value: number): number {
  const snaps = snapPositions.value;
  if (snaps.length < 2) return value;
  const interval = snaps[1]! - snaps[0]!;
  const threshold = interval * 0.35;
  let best = value;
  let bestDist = Infinity;
  for (const s of snaps) {
    const d = Math.abs(value - s);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return bestDist < threshold ? best : value;
}

// ─── Waveform polyline (shape × strength, shifted by offset × strength) ──────
// Mirrors the engine: final = base + (shape + offset) × strength.
const waveformPoints = computed(() => {
  const s = scale.value;
  const off = offset.value;
  const pts: string[] = [];
  const samples = 120;
  const fa = floorActive.value;
  const fy = floorHandleY.value;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const cx = (t * SVG_W).toFixed(1);
    let cy: number;
    if (fa && (t < start.value || t > end.value)) {
      cy = fy;
    } else {
      const raw = evaluatePhase(t * TAU, props.shape, props.params.param, start.value, end.value, off);
      cy = SVG_H / 2 - raw * WAVE_AMP * s;
    }
    pts.push(`${cx},${cy.toFixed(1)}`);
  }
  return pts.join(' ');
});

// ─── Strength handle: at waveform peak (above the offset baseline) ───────────
const strengthHandlePos = computed(() => {
  const s = start.value;
  const e = end.value;
  const w = e - s;
  if (w <= 0) return null;
  const p = props.params.param;
  let localX: number;
  switch (props.shape) {
    case 'sine':      localX = 0.25; break;
    case 'square': {
      const duty = 0.05 + p * 0.9;
      localX = duty * 0.5;
      break;
    }
    case 'triangle': {
      const peak = 0.05 + p * 0.9;
      localX = peak;
      break;
    }
    case 'sawtooth':  localX = p >= 0.5 ? 0.85 : 0.15; break;
    case 'bounce':    localX = 0.5 / Math.round(1 + p * 4); break;
    case 'ramp':      localX = 0.5; break;
    case 'smooth': {
      const peak = 0.05 + p * 0.9;
      localX = peak;
      break;
    }
    default:          localX = 0.25;
  }
  const cx = (s + localX * w) * SVG_W;
  // Peak is shape-peak(=1) + offset, scaled by strength
  const cy = SVG_H / 2 - (1 + offset.value) * WAVE_AMP * scale.value;
  return { cx, cy };
});

// ─── Shape-param handle: shape-specific control point ────────────────────────
const paramHandlePos = computed(() => {
  const s = start.value;
  const e = end.value;
  const w = e - s;
  if (w <= 0) return null;
  const p = props.params.param;
  let localX: number;

  switch (props.shape) {
    case 'sine':    return null;
    case 'square': {
      const duty = 0.05 + p * 0.9;
      localX = Math.min(duty + 0.03, (duty + 1) / 2);
      break;
    }
    case 'triangle': {
      const peak = 0.05 + p * 0.9;
      localX = (peak + 1) / 2;
      break;
    }
    case 'sawtooth': localX = 0.5; break;
    case 'bounce': {
      // Place at last peak: t = 1 - 0.5/count. For count=1 use 0.75 (descending slope).
      const count = Math.round(1 + p * 4);
      localX = count === 1 ? 0.75 : 1 - 0.5 / count;
      break;
    }
    case 'ramp':    localX = 0.5; break;
    case 'smooth': {
      // Same as triangle: param handle on descending slope to avoid overlapping strength handle at peak
      const peak = 0.05 + p * 0.9;
      localX = (peak + 1) / 2;
      break;
    }
    default:        return null;
  }

  const rawY = evaluateShape(props.shape, localX, p);
  const cx = (s + localX * w) * SVG_W;
  const cy = SVG_H / 2 - (rawY + offset.value) * WAVE_AMP * scale.value;
  return { cx, cy };
});

// ─── Start/End handle positions (x = boundary, y = offset baseline) ──────────
// Both handles are linked to the same offset — dragging either one shifts the
// entire wave up/down. The y-position reflects the offset baseline (scaled by
// strength so the visual matches the engine output).
// Start/End handles map directly to offset ∈ [-1, +1] across the full SVG
// height, independent of strength. This lets the user pull the baseline all
// the way to the bottom (offset=-1 → inactive zone = black at 100% strength)
// regardless of the current strength setting.
const startHandlePos = computed(() => ({
  cx: start.value * SVG_W,
  cy: SVG_H / 2 - offset.value * WAVE_AMP,
}));

const endHandlePos = computed(() => ({
  cx: end.value * SVG_W,
  cy: SVG_H / 2 - offset.value * WAVE_AMP,
}));

// ─── Generic drag utility ─────────────────────────────────────────────────────
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

// ─── Shared offset-from-ry helper ────────────────────────────────────────────
// Inverse of: cy = SVG_H/2 - offset * WAVE_AMP
// → offset = (0.5 - ry) / (WAVE_AMP/SVG_H)
// Decoupled from strength: the full SVG height always maps to offset ∈ [-1, 1].
function offsetFromRy(ry: number): number {
  const ampFrac = WAVE_AMP / SVG_H;
  const raw = clamp((0.5 - ry) / ampFrac, -1, 1);
  return Math.abs(raw) < 0.05 ? 0 : Math.round(raw * 100) / 100;
}

// ─── Start handle drag (x = position with snap, y = shared offset) ───────────
function onStartDrag(e: MouseEvent) {
  startDrag(e, (rx, ry) => {
    const snapped = snapValue(clamp(rx, 0, end.value - 0.02));
    emit('update:params', {
      ...props.params,
      start: Math.round(snapped * 1000) / 1000,
      offset: offsetFromRy(ry),
    });
  });
}

// ─── End handle drag (x = position with snap, y = shared offset) ─────────────
function onEndDrag(e: MouseEvent) {
  startDrag(e, (rx, ry) => {
    const snapped = snapValue(clamp(rx, start.value + 0.02, 1));
    emit('update:params', {
      ...props.params,
      end: Math.round(snapped * 1000) / 1000,
      offset: offsetFromRy(ry),
    });
  });
}

// ─── Strength handle drag (y-axis only, supports negative) ───────────────────
// The handle sits at peak + offset. Dragging changes strength while offset stays
// fixed, so the bottom of the wave moves as amplitude changes.
function onStrengthDrag(e: MouseEvent) {
  const ampFrac = WAVE_AMP / SVG_H;
  startDrag(e, (_rx, ry) => {
    // cy = SVG_H/2 - (1 + offset) * WAVE_AMP * scale
    // → scale = (0.5 - ry) / ampFrac / (1 + offset)
    const denom = 1 + offset.value;
    const effectiveFrac = denom === 0 ? ampFrac : ampFrac * denom;
    const newStrength = clamp(Math.round(((0.5 - ry) / effectiveFrac) * 100), -100, 100);
    emit('update:strength', newStrength);
  });
}

// ─── Floor handle drag (y-axis only, fraction of base 0..1) ──────────────────
function onFloorDrag(e: MouseEvent) {
  startDrag(e, (_rx, ry) => {
    const frac = clamp(1 - ry, 0, 1);
    const snapped = Math.round(frac * 100) / 100;
    emit('update:params', { ...props.params, floor: snapped });
  });
}

// Double-click toggles the floor handle on/off. When enabled, starts at 0 (black).
function onFloorToggle(e: MouseEvent) {
  e.stopPropagation();
  emit('update:params', { ...props.params, floor: floorActive.value ? -1 : 0 });
  emit('change-end');
}

// ─── Shape-param handle drag (x-axis, y for sawtooth direction) ──────────────
function onParamDrag(e: MouseEvent) {
  startDrag(e, (rx, ry) => {
    const s = start.value;
    const eVal = end.value;
    const w = eVal - s;
    if (w <= 0) return;
    const localX = clamp((rx - s) / w, 0, 1);
    let newParam = props.params.param;

    switch (props.shape) {
      case 'sine': break;
      case 'square': {
        const duty = clamp(localX - 0.03, 0.05, 0.95);
        newParam = (duty - 0.05) / 0.9;
        break;
      }
      case 'triangle': {
        const peak = clamp(2 * localX - 1, 0.05, 0.95);
        newParam = (peak - 0.05) / 0.9;
        break;
      }
      case 'sawtooth':
        newParam = ry < 0.5 ? 0.75 : 0.25;
        break;
      case 'bounce': {
        // Invert: localX = 1 - 0.5/count → count = 0.5/(1-localX)
        const count = clamp(Math.round(0.5 / Math.max(1 - localX, 0.06)), 1, 5);
        newParam = (count - 1) / 4;
        break;
      }
      case 'ramp':
      case 'smooth': {
        // Handle is at (peak+1)/2; invert: peak = 2*localX - 1
        const peak = clamp(2 * localX - 1, 0.05, 0.95);
        newParam = (peak - 0.05) / 0.9;
        break;
      }
        break;
    }
    emit('update:params', { ...props.params, param: newParam });
  });
}

// ─── Mini shape previews ──────────────────────────────────────────────────────
function miniPoints(shape: WaveformShape): string {
  const pts = sampleWaveform(shape, 0.5, 0, 1, 30);
  return pointsToSvgString(pts, MINI_W, MINI_H);
}
</script>

<template>
  <div class="space-y-2">
    <!-- Shape selector row -->
    <div class="flex gap-1 flex-wrap">
      <button
        v-for="s in ALL_WAVEFORM_SHAPES"
        :key="s"
        class="flex flex-col items-center gap-0.5 px-1 py-1 rounded border transition-all"
        :class="shape === s
          ? 'border-primary/60 bg-primary/10 text-primary'
          : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
        @click="emit('update:shape', s); emit('change-end')"
      >
        <svg :width="MINI_W" :height="MINI_H" :viewBox="`0 0 ${MINI_W} ${MINI_H}`">
          <line :x1="0" :y1="MINI_H / 2" :x2="MINI_W" :y2="MINI_H / 2" stroke="currentColor" stroke-opacity="0.2" stroke-width="0.75" />
          <polyline
            :points="miniPoints(s)"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.85"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="text-[8px] font-medium leading-none">{{ shapeLabel(s) }}</span>
      </button>
    </div>

    <!-- Main waveform editor SVG -->
    <div class="rounded-md border border-border/60 bg-muted/10 overflow-hidden">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
        preserveAspectRatio="none"
        class="w-full block"
        :style="{ height: '80px' }"
        @mousedown.prevent
      >
        <!-- Midline (base channel value) -->
        <line :x1="0" :y1="SVG_H / 2" :x2="SVG_W" :y2="SVG_H / 2"
          stroke="white" stroke-opacity="0.1" stroke-width="1" />

        <!-- Offset baseline (where the wave center sits) — only when offset != 0 -->
        <line
          v-if="offset !== 0"
          :x1="0"
          :y1="SVG_H / 2 - offset * WAVE_AMP"
          :x2="SVG_W"
          :y2="SVG_H / 2 - offset * WAVE_AMP"
          stroke="#eab308"
          stroke-opacity="0.2"
          stroke-width="1"
          stroke-dasharray="4 3"
        />

        <!-- Snap tick marks at the bottom -->
        <line
          v-for="snap in snapPositions"
          :key="snap"
          :x1="snap * SVG_W"
          :y1="SVG_H - 3"
          :x2="snap * SVG_W"
          :y2="SVG_H"
          stroke="white"
          stroke-opacity="0.25"
          stroke-width="1"
        />

        <!-- Inactive zones -->
        <rect v-if="start > 0"
          :x="0" :y="0" :width="start * SVG_W" :height="SVG_H"
          fill="white" fill-opacity="0.04"
        />
        <rect v-if="end < 1"
          :x="end * SVG_W" :y="0" :width="(1 - end) * SVG_W" :height="SVG_H"
          fill="white" fill-opacity="0.04"
        />

        <!-- Waveform polyline -->
        <polyline
          :points="waveformPoints"
          fill="none"
          stroke="#eab308"
          stroke-opacity="0.9"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- ── Floor handle (x=0, vertical only) ── -->
        <!-- Always visible; matches the styling of start/end handles for grabability. -->
        <!-- Sits at the floor level when active, at the midline when disabled. -->
        <line
          v-if="floorActive"
          :x1="0"
          :y1="floorHandleY"
          :x2="SVG_W"
          :y2="floorHandleY"
          stroke="#eab308"
          stroke-opacity="0.25"
          stroke-width="1"
          stroke-dasharray="2 3"
        />
        <circle
          :cx="6"
          :cy="floorActive ? floorHandleY : SVG_H / 2"
          r="5"
          fill="#eab308"
          :fill-opacity="floorActive ? 1 : 0.5"
          stroke="rgba(0,0,0,0.6)"
          stroke-width="1.5"
          style="cursor: ns-resize"
          @mousedown.stop="onFloorDrag"
          @dblclick.stop="onFloorToggle"
        >
          <title>Floor / Inaktivzone-Level. Ziehen zum Setzen, Doppelklick deaktiviert.</title>
        </circle>

        <!-- ── Start boundary line ── -->
        <line
          :x1="start * SVG_W" :y1="PAD_Y" :x2="start * SVG_W" :y2="SVG_H - PAD_Y"
          stroke="#eab308" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="3 2"
        />
        <!-- Start handle: diamond shape (rotated square) for move cursor -->
        <circle
          :cx="startHandlePos.cx"
          :cy="startHandlePos.cy"
          r="5"
          fill="#eab308"
          stroke="rgba(0,0,0,0.6)"
          stroke-width="1.5"
          style="cursor: move"
          @mousedown.stop="onStartDrag"
        />

        <!-- ── End boundary line ── -->
        <line
          :x1="end * SVG_W" :y1="PAD_Y" :x2="end * SVG_W" :y2="SVG_H - PAD_Y"
          stroke="#eab308" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="3 2"
        />
        <!-- End handle -->
        <circle
          :cx="endHandlePos.cx"
          :cy="endHandlePos.cy"
          r="5"
          fill="#eab308"
          stroke="rgba(0,0,0,0.6)"
          stroke-width="1.5"
          style="cursor: move"
          @mousedown.stop="onEndDrag"
        />

        <!-- ── Strength handle (yellow filled, ns-resize) ── -->
        <circle
          v-if="strengthHandlePos"
          :cx="strengthHandlePos.cx"
          :cy="strengthHandlePos.cy"
          r="6"
          fill="#eab308"
          stroke="rgba(0,0,0,0.6)"
          stroke-width="1.5"
          style="cursor: ns-resize"
          @mousedown.stop="onStrengthDrag"
        />

        <!-- ── Shape-param handle (white/yellow, ew-resize) ── -->
        <circle
          v-if="paramHandlePos"
          :cx="paramHandlePos.cx"
          :cy="paramHandlePos.cy"
          r="5"
          fill="white"
          fill-opacity="0.9"
          stroke="#eab308"
          stroke-width="1.5"
          style="cursor: ew-resize"
          @mousedown.stop="onParamDrag"
        />
      </svg>
    </div>
  </div>
</template>
