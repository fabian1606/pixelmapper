<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { reapplyColorOverrideForActive, setColorOverride } from '~/composables/live-ops/color-override-ops';
import { getPresetNaturalRGB, hsvToRgb, rgbToHsv, type RGB } from '~/utils/live/color-utils';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const engineStore = useEngineStore();
const liveStore = useLiveModeStore();

const activePresetId = computed(() => engineStore.selectedPresetId);

const naturalRGB = computed<RGB | null>(() => {
  const id = activePresetId.value;
  if (!id) return null;
  return getPresetNaturalRGB(id, engineStore.savedPresets);
});

/** Effective base color: override if set, else preset's natural RGB. */
const effectiveRGB = computed<RGB | null>(() => {
  const id = activePresetId.value;
  if (!id) return null;
  return liveStore.presetColorOverrides.get(id) ?? naturalRGB.value;
});

const hasOverride = computed(() => {
  const id = activePresetId.value;
  return !!id && liveStore.presetColorOverrides.has(id);
});

const hasColorChannels = computed(() => naturalRGB.value !== null);

// ── Wheel math ────────────────────────────────────────────────────────────────
// Pointer position → HSV (angle = hue 0–360, distance/radius = saturation 0–1),
// value fixed at 1. Then HSV → RGB.

const wheelRef = ref<HTMLElement | null>(null);

function rgbFromPos(x: number, y: number, radius: number): RGB {
  let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
  if (angle < 0) angle += 360;
  const dist = Math.min(Math.sqrt(x * x + y * y), radius);
  const sat = dist / radius;
  return hsvToRgb(angle, sat, 1);
}

function handlePosFromRGB(rgb: RGB): { left: string; top: string; color: string } {
  const { h, s } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const angleDeg = h - 90;
  const angleRad = angleDeg * Math.PI / 180;
  const dist = s; // 0–1
  const left = 50 + Math.cos(angleRad) * dist * 50;
  const top = 50 + Math.sin(angleRad) * dist * 50;
  return { left: `${left}%`, top: `${top}%`, color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` };
}

const handleStyle = computed(() => {
  const rgb = effectiveRGB.value;
  if (!rgb) return { left: '50%', top: '50%', color: 'rgba(255,255,255,0.5)' };
  return handlePosFromRGB(rgb);
});

const isDragging = ref(false);

function getRelPos(e: PointerEvent, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  return { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy, radius: Math.min(cx, cy) };
}

/** Local-only update: instant feedback, no broadcast. */
function setOverrideLocal(rgb: RGB) {
  const id = activePresetId.value;
  if (!id) return;
  liveStore.setPresetColor(id, rgb);
  reapplyColorOverrideForActive();
}

/** Commit locally + broadcast (LiveBus) — used on pointer-up and reset. */
function commitOverride(rgb: RGB | null) {
  const id = activePresetId.value;
  if (!id) return;
  setColorOverride(id, rgb);
}

function onPointerDown(e: PointerEvent) {
  if (props.editMode || !activePresetId.value) return;
  if (e.button !== 0) return;
  const el = wheelRef.value;
  if (!el) return;
  e.preventDefault();
  isDragging.value = true;
  el.setPointerCapture(e.pointerId);
  const pos = getRelPos(e, el);
  setOverrideLocal(rgbFromPos(pos.x, pos.y, pos.radius));
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value || props.editMode) return;
  const el = wheelRef.value;
  if (!el) return;
  const pos = getRelPos(e, el);
  setOverrideLocal(rgbFromPos(pos.x, pos.y, pos.radius));
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  const el = wheelRef.value;
  if (!el) return;
  const pos = getRelPos(e, el);
  const rgb = rgbFromPos(pos.x, pos.y, pos.radius);
  setOverrideLocal(rgb);
  commitOverride(rgb);
}

function resetOverride() {
  if (props.editMode) return;
  commitOverride(null);
}

const activePresetName = computed(() =>
  engineStore.savedPresets?.find((p: any) => p.id === activePresetId.value)?.name ?? null
);

const readout = computed(() => {
  const rgb = effectiveRGB.value;
  if (!rgb) return '';
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
});
</script>

<template>
  <div
    class="w-full h-full rounded border border-white/10 flex flex-col p-2 gap-1 select-none overflow-hidden"
    style="background-color: #1a1a1a;"
    :class="editMode ? 'pointer-events-none' : ''"
  >
    <!-- Header: label + preset name + reset -->
    <div class="w-full flex items-center justify-between shrink-0 gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {{ widget.label || 'Color' }}
        </span>
        <span v-if="activePresetName" class="text-[9px] text-muted-foreground/60 truncate">
          {{ activePresetName }}
        </span>
      </div>
      <button
        v-if="!editMode && hasOverride"
        class="text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1 rounded shrink-0"
        title="Override zurücksetzen"
        @click.stop="resetOverride"
      >
        ✕
      </button>
    </div>

    <!-- Wheel -->
    <div class="relative flex-1 min-h-0 flex items-center justify-center">
      <div
        ref="wheelRef"
        class="relative rounded-full touch-none"
        :class="(editMode || !activePresetId) ? 'cursor-not-allowed' : 'cursor-crosshair'"
        style="
          aspect-ratio: 1;
          height: 100%;
          max-width: 100%;
          background: conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red);
        "
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <!-- White center overlay (low saturation) -->
        <div
          class="absolute inset-0 rounded-full pointer-events-none"
          style="background: radial-gradient(circle at center, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 70%);"
        />
        <!-- Dark rim -->
        <div
          class="absolute inset-0 rounded-full pointer-events-none"
          style="background: radial-gradient(circle at center, rgba(0,0,0,0) 70%, rgba(0,0,0,0.2) 100%);"
        />

        <!-- Handle: always shows the effective base color -->
        <div
          v-if="hasColorChannels"
          class="absolute w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none transition-none"
          :style="{
            left: handleStyle.left,
            top: handleStyle.top,
            transform: 'translate(-50%, -50%)',
            backgroundColor: handleStyle.color,
          }"
        />

        <!-- No-preset hint -->
        <div
          v-if="!activePresetId && !editMode"
          class="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none"
        >
          <span class="text-[9px] text-white/50 px-2 text-center">Preset wählen</span>
        </div>

        <!-- Bottom-corner readout (overlaid, doesn't change wheel size) -->
        <div
          v-if="hasColorChannels"
          class="absolute bottom-1 right-2 text-[9px] font-mono text-white/70 pointer-events-none drop-shadow"
        >
          {{ readout }}
        </div>
      </div>
    </div>
  </div>
</template>
