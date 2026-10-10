<script setup lang="ts">
/**
 * Small animated thumbnail of a plugin's default recipe (plan M5.7, Add
 * menu): the recipe on a 16-pixel endless strip at ~10 fps while mounted.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { createModifier } from '~/utils/engine/modifiers';
import { applyPreset, pickPreset } from '~/utils/engine/recipes';
import { getManifest } from '~/utils/plugins/plugin-store';
import { previewRgb, renderStrip } from '~/utils/plugins/preview-pool';
import { sampleClock } from '~/composables/engine/use-modifier-phase';
import { analyzeSelection } from '~/utils/engine/distribution/selection-shape';

const props = defineProps<{ plugin: string }>();

const COLS = 16;
const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let last = 0;

/** A preview instance with the default recipe applied. */
const instance = computed(() => {
  const manifest = getManifest(props.plugin);
  if (!manifest) return null;
  const base = { ...createModifier(props.plugin, { targetChannels: ['DIMMER'] }), id: `thumb:${props.plugin}` };
  const preset = pickPreset(manifest, { shape: analyzeSelection([]), hasColor: true });
  return preset ? applyPreset(base, manifest, preset) : base;
});

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (now - last < 100) return;
  last = now;
  const g = canvas.value?.getContext('2d');
  const m = instance.value;
  if (!g || !m) return;
  const c = sampleClock();
  const r = renderStrip(m, COLS, { timeMs: c.timeMs, bpm: c.bpm, rankCount: 8 });
  if (!r) return;
  const img = g.createImageData(COLS, 1);
  for (let k = 0; k < COLS; k++) img.data.set([...previewRgb(r, k), 255], k * 4);
  g.putImageData(img, 0, 0);
}

onMounted(() => { raf = requestAnimationFrame(frame); });
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas ref="canvas" :width="COLS" height="1" class="block w-10 h-4 shrink-0 rounded-sm bg-black" style="image-rendering: pixelated" aria-hidden="true" />
</template>
