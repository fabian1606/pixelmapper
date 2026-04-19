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

// Resolved hold levels (use explicit value or fall back to shape's natural boundary)
const resolvedStartLevel = computed(() =>
  props.params.startLevel ?? evaluateShape(props.shape, 0, props.params.param)
);
const resolvedEndLevel = computed(() =>
  props.params.endLevel ?? evaluateShape(props.shape, 1, props.params.param)
);

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

// ─── Waveform polyline (strength-scaled, uses startLevel/endLevel) ────────────
const waveformPoints = computed(() => {
  const s = scale.value;
  const sl = resolvedStartLevel.value;
  const el = resolvedEndLevel.value;
  const pts: string[] = [];
  const samples = 120;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const raw = evaluatePhase(t * TAU, props.shape, props.params.param, start.value, end.value, sl, el);
    const cx = (t * SVG_W).toFixed(1);
    const cy = (SVG_H / 2 - raw * WAVE_AMP * s).toFixed(1);
    pts.push(`${cx},${cy}`);
  }
  return pts.join(' ');
});

// ─── Strength handle: at waveform peak ───────────────────────────────────────
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
    case 'bounce':    localX = 0.5 / Math.round(1 + p * 4); break; // first peak of the bounce
    case 'ramp':      localX = 0.5; break;
    case 'smooth': {
      const peak = 0.05 + p * 0.9;
      localX = peak;
      break;
    }
    default:          localX = 0.25;
  }
  const cx = (s + localX * w) * SVG_W;
  const cy = SVG_H / 2 - WAVE_AMP * scale.value; // positive peak
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
  const cy = SVG_H / 2 - rawY * WAVE_AMP * scale.value;
  return { cx, cy };
});

// ─── Start/End handle positions (x = boundary, y = hold level) ───────────────
const startHandlePos = computed(() => ({
  cx: start.value * SVG_W,
  cy: SVG_H / 2 - resolvedStartLevel.value * WAVE_AMP * scale.value,
}));

const endHandlePos = computed(() => ({
  cx: end.value * SVG_W,
  cy: SVG_H / 2 - resolvedEndLevel.value * WAVE_AMP * scale.value,
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

// ─── Shared level-from-ry helper ─────────────────────────────────────────────
// Inverse of: cy = SVG_H/2 - level * WAVE_AMP * scale
// → level = (0.5 - ry) / (WAVE_AMP/SVG_H) / scale
function levelFromRy(ry: number): number {
  const ampFrac = WAVE_AMP / SVG_H;
  const s = scale.value === 0 ? 1 : scale.value; // avoid div by zero
  const raw = clamp((0.5 - ry) / ampFrac / s, -1, 1);
  // Snap to zero if within ~10% of the full amplitude range
  const zeroThreshold = 0.1;
  return Math.abs(raw) < zeroThreshold ? 0 : raw;
}

// ─── Start handle drag (x = position with snap, y = hold level) ──────────────
function onStartDrag(e: MouseEvent) {
  startDrag(e, (rx, ry) => {
    const snapped = snapValue(clamp(rx, 0, end.value - 0.02));
    const newLevel = levelFromRy(ry);
    emit('update:params', {
      ...props.params,
      start: Math.round(snapped * 1000) / 1000,
      startLevel: Math.round(newLevel * 100) / 100,
    });
  });
}

// ─── End handle drag (x = position with snap, y = hold level) ────────────────
function onEndDrag(e: MouseEvent) {
  startDrag(e, (rx, ry) => {
    const snapped = snapValue(clamp(rx, start.value + 0.02, 1));
    const newLevel = levelFromRy(ry);
    emit('update:params', {
      ...props.params,
      end: Math.round(snapped * 1000) / 1000,
      endLevel: Math.round(newLevel * 100) / 100,
    });
  });
}

// ─── Strength handle drag (y-axis only, supports negative) ───────────────────
function onStrengthDrag(e: MouseEvent) {
  const ampFrac = WAVE_AMP / SVG_H;
  startDrag(e, (_rx, ry) => {
    const newStrength = clamp(Math.round(((0.5 - ry) / ampFrac) * 100), -100, 100);
    emit('update:strength', newStrength);
  });
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
        <!-- Midline -->
        <line :x1="0" :y1="SVG_H / 2" :x2="SVG_W" :y2="SVG_H / 2"
          stroke="white" stroke-opacity="0.1" stroke-width="1" />

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
