<script setup lang="ts">
/**
 * Recipe bar of a modifier card (plan M5.2): one tile per manifest preset
 * with an animated 64×28 thumbnail (the preset on a 24-pixel endless strip,
 * ~15 fps, paused off-screen) and its label. The active tile is the preset
 * whose params equal the instance's. Clicking applies the whole recipe as
 * one undo step (the caller commits).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import type { ModifierInstance } from '~/utils/engine/types';
import { activePreset, applyPreset, applyPresetOnSelection } from '~/utils/engine/recipes';
import type { SelectionShape } from '~/utils/engine/distribution/selection-shape';
import { previewRgb, renderStrip } from '~/utils/plugins/preview-pool';
import { sampleClock } from '~/composables/engine/use-modifier-phase';

const props = defineProps<{
  modifier: ModifierInstance;
  manifest: ContentPluginManifest;
  rankCount?: number;
  /** Current selection (recipes that change the mode are placed on it). */
  selectionShape?: SelectionShape;
}>();

const emit = defineEmits<{
  apply: [next: ModifierInstance, preset: ManifestPreset];
}>();

const COLS = 24;
const presets = computed(() => props.manifest.presets ?? []);
const active = computed(() => activePreset(props.modifier, props.manifest));

const root = ref<HTMLElement | null>(null);
const canvases = ref<HTMLCanvasElement[]>([]);
const visible = ref(true);
let raf = 0;
let last = 0;
let observer: IntersectionObserver | null = null;

/** Thumbnail instance of a preset (own preview id so state is not shared). */
function thumbInstance(p: ManifestPreset): ModifierInstance {
  return { ...applyPreset(props.modifier, props.manifest, p), id: `${props.modifier.id}:recipe:${p.id}`, strength: p.strength ?? 1 };
}

/** Draws every thumbnail (~15 fps). */
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!visible.value || now - last < 1000 / 15) return;
  last = now;
  const c = sampleClock();
  presets.value.forEach((p, i) => {
    const g = canvases.value[i]?.getContext('2d');
    const r = g ? renderStrip(thumbInstance(p), COLS, { timeMs: c.timeMs, bpm: c.bpm, rankCount: props.rankCount || 8 }) : null;
    if (!g || !r) return;
    const img = g.createImageData(COLS, 1);
    for (let k = 0; k < COLS; k++) {
      const [red, green, blue] = previewRgb(r, k);
      img.data.set([red, green, blue, 255], k * 4);
    }
    g.putImageData(img, 0, 0);
  });
}

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    observer = new IntersectionObserver(([e]) => { visible.value = !!e?.isIntersecting; });
    observer.observe(root.value);
  }
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  observer?.disconnect();
});
</script>

<template>
  <div v-if="presets.length" ref="root" class="flex flex-wrap gap-1" role="toolbar" aria-label="Recipes" data-recipe-bar>
    <button
      v-for="(p, i) in presets"
      :key="p.id"
      type="button"
      class="flex flex-col items-center gap-0.5 rounded border p-0.5 w-[70px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="active?.id === p.id ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
      :aria-pressed="active?.id === p.id"
      :title="p.description ?? p.label"
      :data-recipe="p.id"
      @click.stop="emit('apply', applyPresetOnSelection(modifier, manifest, p, selectionShape), p)"
    >
      <canvas :ref="el => { if (el) canvases[i] = el as HTMLCanvasElement }" :width="COLS" height="1" class="block w-16 h-7 rounded-sm bg-black" style="image-rendering: pixelated" aria-hidden="true" />
      <span class="w-full truncate text-center text-[9px] font-medium leading-tight">{{ p.label }}</span>
    </button>
  </div>
</template>
