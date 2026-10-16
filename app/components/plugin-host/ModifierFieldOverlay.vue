<script setup lang="ts">
/**
 * Canvas overlay of the active modifier over the world (plan P3.14; replaces
 * the former `getPreviewCSS`). Renders a coarse grid through the preview pool
 * every animation frame while mounted; the parent shows it during spatial
 * handle drags and positions it in world space.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { previewRgb, renderField } from '~/utils/plugins/preview-pool';

const props = withDefaults(defineProps<{
  modifier: ModifierInstance;
  /** Tempo for beat speeds. */
  bpm?: number;
  cols?: number;
  rows?: number;
}>(), { bpm: 120, cols: 64, rows: 36 });

const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;
const start = performance.now();

/** Renders one frame of the field into the low-res canvas (scaled by CSS). */
function frame() {
  raf = requestAnimationFrame(frame);
  const g = canvas.value?.getContext('2d');
  if (!g) return;
  const result = renderField(props.modifier, props.cols, props.rows, { timeMs: performance.now() - start, bpm: props.bpm });
  if (!result) return;
  const img = g.createImageData(props.cols, props.rows);
  for (let i = 0; i < props.cols * props.rows; i++) {
    const [r, gg, b] = previewRgb(result, i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

onMounted(() => { raf = requestAnimationFrame(frame); });
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas
    ref="canvas"
    :width="cols"
    :height="rows"
    class="pointer-events-none w-full h-full opacity-40"
    style="image-rendering: pixelated"
  />
</template>
