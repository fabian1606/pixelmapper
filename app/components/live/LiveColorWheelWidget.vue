<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { applyHueOverrideEffect } from '~/composables/live-ops/hue-ops';
import type { ColorParams } from '~/utils/engine/types';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();
const liveStore = useLiveModeStore();

const scope = computed(() => props.widget.colorWheelScope ?? 'preset');

const overrideKey = computed<string | null>(() => {
  if (scope.value === 'global') return 'global';
  return engineStore.selectedPresetId ?? null;
});

const currentParams = computed<ColorParams>(() => {
  const key = overrideKey.value;
  if (!key) return { hueShift: 0, saturation: 1, hueRange: 0, satRange: 0 };
  return liveStore.presetHueOverrides.get(key) ?? { hueShift: 0, saturation: 1, hueRange: 0, satRange: 0 };
});

// ── Circular wheel ────────────────────────────────────────────────────────────
// Angle on the wheel = hueShift (0-360), mapped to hueShift (-180 to +180).
// Distance from center = saturation multiplier (0 at center → 1 at 50% → 2 at rim).

const wheelRef = ref<HTMLElement | null>(null);

function paramsFromPos(x: number, y: number, radius: number): ColorParams {
  // angle in degrees (0 = right, 90 = down, like CSS conic)
  let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
  if (angle < 0) angle += 360;
  // Convert 0-360 → hueShift -180..+180
  const hueShift = angle > 180 ? angle - 360 : angle;

  const dist = Math.min(Math.sqrt(x * x + y * y), radius);
  // center = saturation 1 (unchanged), rim = 2 (vivid), but allow going toward 0 via negative dist
  // Map: 0..radius → 0..2  (simple linear; center = 0)
  const saturation = Math.round(((dist / radius) * 2) * 100) / 100;

  return { hueShift: Math.round(hueShift), saturation, hueRange: 0, satRange: 0 };
}

function handleFromParams(params: ColorParams, containerSize: number): { left: string; top: string; color: string } {
  const radius = containerSize / 2;
  // hueShift -180..+180 → angle 0..360
  let angle = params.hueShift < 0 ? params.hueShift + 360 : params.hueShift;
  // account for conic-gradient start offset
  const angleDeg = angle - 90;
  const angleRad = angleDeg * Math.PI / 180;
  // saturation 0..2 → distance 0..radius
  const dist = Math.min((params.saturation / 2) * radius, radius);

  const left = 50 + (Math.cos(angleRad) * dist / radius) * 50;
  const top = 50 + (Math.sin(angleRad) * dist / radius) * 50;

  // Show target hue as handle color (full saturation/brightness)
  const hue = ((params.hueShift % 360) + 360) % 360;
  const color = `hsl(${hue}deg,100%,50%)`;
  return { left: `${left}%`, top: `${top}%`, color };
}

const containerSize = computed(() => {
  // Use widget h in grid cells * gridSize as proxy; fallback to 120
  return 120;
});

const handleStyle = computed(() => handleFromParams(currentParams.value, containerSize.value));
const hasOverride = computed(() => overrideKey.value != null && liveStore.presetHueOverrides.has(overrideKey.value));

const isDragging = ref(false);

function getRelPos(e: MouseEvent | PointerEvent, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  return { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy, radius: Math.min(cx, cy) };
}

function dispatchLocal(params: ColorParams) {
  const key = overrideKey.value;
  if (!key) return;
  liveStore.setPresetHue(key, params);
  applyHueOverrideEffect();
}

function dispatchBroadcast(params: ColorParams) {
  const key = overrideKey.value;
  if (!key) return;
  liveBus.dispatch('hue.update', { key, params });
}

function onPointerDown(e: PointerEvent) {
  if (props.editMode) return;
  if (e.button !== 0) return;
  const el = wheelRef.value;
  if (!el) return;
  e.preventDefault();
  isDragging.value = true;
  el.setPointerCapture(e.pointerId);

  const pos = getRelPos(e, el);
  dispatchLocal(paramsFromPos(pos.x, pos.y, pos.radius));
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value || props.editMode) return;
  const el = wheelRef.value;
  if (!el) return;
  const pos = getRelPos(e, el);
  dispatchLocal(paramsFromPos(pos.x, pos.y, pos.radius));
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  const el = wheelRef.value;
  if (!el) return;
  const pos = getRelPos(e, el);
  dispatchBroadcast(paramsFromPos(pos.x, pos.y, pos.radius));
}

function resetHue() {
  if (props.editMode) return;
  const key = overrideKey.value;
  if (!key) return;
  liveBus.dispatch('hue.update', { key, params: null });
}

const scopeLabel = computed(() => {
  if (scope.value === 'global') return 'Global';
  if (scope.value === 'variant') return 'Variant';
  return 'Preset';
});

const activePresetName = computed(() =>
  engineStore.savedPresets?.find((p: any) => p.id === engineStore.selectedPresetId)?.name ?? null
);
</script>

<template>
  <div
    class="w-full h-full rounded border border-white/10 flex flex-col items-center justify-between p-2 gap-1 select-none overflow-hidden"
    style="background-color: #1a1a1a;"
    :class="editMode ? 'pointer-events-none' : ''"
  >
    <!-- Header -->
    <div class="w-full flex items-center justify-between shrink-0">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ widget.label || 'Color' }}
      </span>
      <div class="flex items-center gap-2">
        <span class="text-[9px] text-muted-foreground/50">{{ scopeLabel }}{{ activePresetName ? ` · ${activePresetName}` : '' }}</span>
        <button
          v-if="!editMode && hasOverride"
          class="text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1 rounded"
          @click.stop="resetHue"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Color Wheel (circular, like FixtureColorPicker) -->
    <div
      ref="wheelRef"
      class="relative rounded-full cursor-crosshair touch-none"
      style="
        flex: 1 1 auto;
        max-width: 100%;
        aspect-ratio: 1;
        background: conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red);
      "
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- White center overlay (desaturated center) -->
      <div
        class="absolute inset-0 rounded-full pointer-events-none"
        style="background: radial-gradient(circle at center, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 60%); mix-blend-mode: screen;"
      />
      <!-- Dark rim for depth -->
      <div
        class="absolute inset-0 rounded-full pointer-events-none"
        style="background: radial-gradient(circle at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.25) 100%);"
      />

      <!-- "No shift" center indicator -->
      <div
        class="absolute rounded-full border border-white/40 pointer-events-none"
        style="width: 6px; height: 6px; top: calc(50% - 3px); left: calc(50% - 3px); background: rgba(255,255,255,0.3);"
      />

      <!-- Handle -->
      <div
        class="absolute w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none transition-none"
        :class="hasOverride ? 'opacity-100' : 'opacity-40'"
        :style="{
          left: handleStyle.left,
          top: handleStyle.top,
          transform: 'translate(-50%, -50%)',
          backgroundColor: handleStyle.color,
        }"
      />

      <!-- No-override hint -->
      <div
        v-if="!hasOverride && !editMode"
        class="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none"
      >
        <span class="text-[9px] text-white/30">Drag to shift</span>
      </div>
    </div>

    <!-- Hue shift readout -->
    <div v-if="hasOverride" class="text-[9px] text-muted-foreground/60 shrink-0">
      {{ currentParams.hueShift > 0 ? '+' : '' }}{{ currentParams.hueShift }}°
    </div>
  </div>
</template>
