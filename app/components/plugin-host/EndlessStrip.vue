<script setup lang="ts">
/**
 * Endless strip (plan M5.4, principle 3): the modifier's behaviour on 256
 * virtual pixels with a continuous `spatial`, at the instance's real speed
 * on the shared clock. Scalar → greyscale, rgb → colors, panTilt → hidden.
 * Throttled to ~30 fps and paused while off-screen.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { previewRgb, renderStrip } from '~/utils/plugins/preview-pool';
import { sampleClock } from '~/composables/engine/use-modifier-phase';

const props = withDefaults(defineProps<{
  modifier: ModifierInstance;
  /** Order ranks on the stage (0 = unknown → 16 virtual ranks). */
  rankCount?: number;
  /** Pixels of the strip. */
  cols?: number;
}>(), { rankCount: 0, cols: 256 });

const canvas = ref<HTMLCanvasElement | null>(null);
const visible = ref(true);
let raf = 0;
let last = 0;
let observer: IntersectionObserver | null = null;

/** Draws one frame. */
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!visible.value || now - last < 1000 / 30) return;
  last = now;
  const el = canvas.value;
  const g = el?.getContext('2d');
  if (!el || !g || props.modifier.signature === 'panTilt') return;
  const c = sampleClock();
  const r = renderStrip(props.modifier, props.cols, { timeMs: c.timeMs, bpm: c.bpm, rankCount: props.rankCount });
  if (!r) return;
  const img = g.createImageData(props.cols, 1);
  for (let i = 0; i < props.cols; i++) {
    const [red, green, blue] = previewRgb(r, i);
    img.data[i * 4] = red;
    img.data[i * 4 + 1] = green;
    img.data[i * 4 + 2] = blue;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && canvas.value) {
    observer = new IntersectionObserver(([e]) => { visible.value = !!e?.isIntersecting; });
    observer.observe(canvas.value);
  }
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  observer?.disconnect();
});

defineExpose({ visible });
</script>

<template>
  <canvas
    v-if="modifier.signature !== 'panTilt'"
    ref="canvas"
    :width="cols"
    height="1"
    class="block w-full h-[14px] rounded-sm bg-black"
    style="image-rendering: pixelated"
    aria-label="Behaviour preview"
    data-endless-strip
  />
</template>
