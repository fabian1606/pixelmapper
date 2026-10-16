<script setup lang="ts">
/**
 * One-cycle preview of a modifier instance on its card (plan P3.14),
 * rendered by the main-thread preview pool: scalar → curve, rgb → color
 * strip, panTilt → path on an XY field. Re-renders on any instance change.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { previewRevision, previewRgb, releasePreview, renderCycle } from '~/utils/plugins/preview-pool';

const props = withDefaults(defineProps<{
  modifier: ModifierInstance;
  height?: number;
}>(), { height: 36 });

/** Samples per preview. */
const SAMPLES = 96;

const canvas = ref<HTMLCanvasElement | null>(null);

/** Draws the preview (empty while the plugin loads or after a trap). */
function draw() {
  const el = canvas.value;
  const g = el?.getContext('2d');
  if (!el || !g) return;
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth || 200;
  const h = props.height;
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const result = renderCycle(props.modifier, SAMPLES);
  if (!result) return;
  const primary = getComputedStyle(el).color;

  if (result.arity === 3) {
    // Color strip.
    const bw = w / SAMPLES;
    for (let i = 0; i < SAMPLES; i++) {
      const [r, gg, b] = previewRgb(result, i);
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(i * bw, 0, bw + 0.5, h);
    }
    return;
  }

  g.strokeStyle = primary;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < SAMPLES; i++) {
    const v = result.values;
    // panTilt: path in an XY field; scalar: value over the cycle.
    const x = result.arity === 2 ? v[i * 2]! * w : (i / (SAMPLES - 1)) * w;
    const y = result.arity === 2 ? (1 - v[i * 2 + 1]!) * h : (1 - v[i]!) * (h - 2) + 1;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

watch(() => [props.modifier, previewRevision.value], () => requestAnimationFrame(draw), { deep: true });
onMounted(draw);
onBeforeUnmount(() => releasePreview(props.modifier.id));
</script>

<template>
  <canvas
    ref="canvas"
    class="block w-full rounded bg-muted/30 text-primary"
    :style="{ height: `${height}px` }"
  />
</template>
