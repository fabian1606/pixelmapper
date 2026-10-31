<script setup lang="ts">
/**
 * Core live widget `color` (ADR §5.7): overrides the active preset's color,
 * rendered with the replaceable `pm.colorInput` (core default: RGB faders +
 * hex; color-picker extension: wheel). Writes during a drag are
 * rAF-throttled locally; the final color is committed and broadcast as a
 * color override on `scrubEnd`. The ✕ button resets the override.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { RgbColor } from '@pixelmapper/extension-api';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { applyRGBToActivePreset, setColorOverride, getEffectiveRGB } from '~/composables/live-ops/color-override-ops';
import { getPresetNaturalRGB, type RGB } from '~/utils/live/color-utils';
import { recordLiveStep } from '~/composables/live-ops/live-history';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const engineStore = useEngineStore();

const activePresetId = computed(() => engineStore.selectedPresetId);
const activePreset = computed(() => engineStore.savedPresets.find(p => p.id === activePresetId.value) ?? null);

/** Preset color without overrides. */
const naturalRGB = computed<RGB | null>(() =>
  activePresetId.value ? getPresetNaturalRGB(activePresetId.value, engineStore.savedPresets) : null);

/** Current color derived from the live fixture state. */
const effectiveRGB = computed<RGB | null>(() =>
  activePreset.value ? getEffectiveRGB(activePreset.value, engineStore.flatFixtures) : null);

/** True when the live color differs from the preset's natural color. */
const hasOverride = computed(() => {
  const eff = effectiveRGB.value;
  const nat = naturalRGB.value;
  if (!eff || !nat) return false;
  return Math.abs(eff.r - nat.r) > 1 || Math.abs(eff.g - nat.g) > 1 || Math.abs(eff.b - nat.b) > 1;
});

/** Color shown by the input (local preview while dragging). */
const preview = ref<RGB | null>(null);
const value = computed<RgbColor>(() => {
  const rgb = preview.value ?? effectiveRGB.value ?? { r: 0, g: 0, b: 0 };
  return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 };
});

// ─── Writing ────────────────────────────────────────────────────────────────

let rafId: number | null = null;
let pending: RGB | null = null;

/** Applies a color locally (rAF-throttled fixture writes). */
function onInput(c: RgbColor) {
  if (!activePresetId.value) return;
  const rgb = { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
  preview.value = rgb;
  pending = rgb;
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (pending) applyRGBToActivePreset(pending);
    pending = null;
  });
}

/** Commits and broadcasts the final color of an edit. */
function onScrubEnd() {
  const id = activePresetId.value;
  if (id && preview.value) {
    // One wheel gesture = one step (the tracked override is still the one from before the drag).
    recordLiveStep();
    setColorOverride(id, preview.value);
  }
  preview.value = null;
}

function resetOverride() {
  const id = activePresetId.value;
  if (!id || props.editMode) return;
  preview.value = null;
  recordLiveStep();
  setColorOverride(id, null);
}

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div
    class="w-full h-full rounded border border-white/10 flex flex-col p-2 gap-1 select-none overflow-hidden"
    style="background-color: #1a1a1a;"
    :class="editMode && 'pointer-events-none'"
  >
    <!-- Header: label + preset name + reset -->
    <div class="w-full flex items-center justify-between shrink-0 gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {{ widget.label || 'Color' }}
        </span>
        <span v-if="activePreset" class="text-[9px] text-muted-foreground/60 truncate">{{ activePreset.name }}</span>
      </div>
      <button
        v-if="!editMode && hasOverride"
        class="text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1 rounded shrink-0"
        title="Reset override"
        @click.stop="resetOverride"
      >
        ✕
      </button>
    </div>

    <div class="relative flex-1 min-h-0 flex items-center justify-center">
      <Replaceable
        name="pm.colorInput"
        size="lg"
        :model-value="value"
        :disabled="!activePresetId"
        @update:model-value="onInput"
        @scrub-end="onScrubEnd"
      />
      <span
        v-if="!activePresetId && !editMode"
        class="absolute inset-0 flex items-center justify-center text-[9px] text-white/50 pointer-events-none"
      >Select a preset</span>
    </div>
  </div>
</template>
