<script setup lang="ts">
/**
 * Effect hover preview of a version (version history): the snapshot's
 * fixture layout with one added/changed effect animated live on its target
 * fixtures (~30 fps via the main-thread preview pool, no second engine),
 * plus the effect name and the changed settings in words.
 *
 * Falls back to a static frame (targets highlighted in their base colors)
 * while the plugin instance loads, when the plugin is unknown or broken, and
 * under `prefers-reduced-motion: reduce` (one frame). Starts animating when
 * the instance becomes ready (`previewRevision`). The loop stops on unmount
 * and while the document is hidden. The median render time of the last
 * frames (plugin + colors + draw) is exposed as `data-frame-ms` on the canvas.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { getManifest, pluginRevision } from '~/utils/plugins/plugin-store';
import { previewRevision, releasePreview, renderPoints } from '~/utils/plugins/preview-pool';
import { createEffectAnimator } from '~/utils/sync/version-preview/effect-animator';
import { drawEffectFrame, type EffectScene } from '~/utils/sync/version-preview/effect-canvas';
import { buildEffectPoints, effectColors, effectTargets } from '~/utils/sync/version-preview/effect-preview';
import { describeEffectChange, effectTitle } from '~/utils/sync/version-preview/effect-text';
import type { EffectHighlight } from '~/utils/sync/version-preview/highlight-types';
import { fitCamera, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

const props = withDefaults(defineProps<{
  model: PreviewModel;
  highlight: EffectHighlight;
  /** Fixture id → index into `model.fixtures`. */
  fixtureIndex: Record<string, number>;
  width?: number;
  height?: number;
  /** Show the name / change caption under the canvas. */
  caption?: boolean;
}>(), { width: 320, height: 200, caption: true });

/** Frames kept for the render-time median. */
const TIMING_WINDOW = 30;

/** Unique pool slot so the live modifier card keeps its own instance. */
const instanceKey = `version-preview:${Math.random().toString(36).slice(2)}`;

const canvas = ref<HTMLCanvasElement | null>(null);
const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

// ── Derived scene ───────────────────────────────────────────────────────────

/** Manifest of the effect's plugin (re-evaluated when plugins resolve). */
const manifest = computed(() => {
  void pluginRevision.value;
  return getManifest(props.highlight.modifier.plugin);
});
const title = computed(() => effectTitle(props.highlight, manifest.value));
const detail = computed(() => (props.highlight.status === 'changed' ? describeEffectChange(props.highlight, manifest.value) : ''));

/** Targets, sample points and the static draw state. */
const prepared = computed(() => {
  const m = props.highlight.modifier;
  const targets = effectTargets(m, props.model, props.fixtureIndex);
  const pts = buildEffectPoints(m, props.model, targets, props.fixtureIndex);
  const scene: EffectScene = {
    model: props.model,
    camera: fitCamera(props.model.bounds, props.width, props.height),
    targets: pts.targets,
    targetSet: new Set(targets),
    width: props.width,
    height: props.height,
    dpr,
  };
  return { pts, scene };
});

// ── Frame rendering ─────────────────────────────────────────────────────────

let ctx: CanvasRenderingContext2D | null = null;
/** Reused color buffer. */
let colors: Uint8ClampedArray | undefined;
const timings: number[] = [];
const frames = shallowRef(0);

/** Records one frame's render time and publishes the median. */
function record(ms: number): void {
  timings.push(ms);
  if (timings.length > TIMING_WINDOW) timings.shift();
  const sorted = [...timings].sort((a, b) => a - b);
  const el = canvas.value;
  if (!el) return;
  el.dataset.frameMs = sorted[Math.floor(sorted.length / 2)]!.toFixed(3);
  el.dataset.frameCount = String(++frames.value);
}

/** Draws the frame at `elapsedMs`; false when the effect cannot animate (static frame drawn). */
function drawFrame(elapsedMs: number): boolean {
  const t0 = performance.now();
  const { pts, scene } = prepared.value;
  let animated = false;
  try {
    const result = manifest.value && pts.points.length > 0
      ? renderPoints(props.highlight.modifier, pts.points, { timeMs: elapsedMs, rankCount: pts.rankCount, ticks: pts.ticks, instanceKey })
      : null;
    animated = result !== null;
    colors = result ? effectColors(result, pts.tint, colors) : undefined;
    if (ctx) drawEffectFrame(ctx, scene, colors ?? null);
  }
  catch (err) {
    console.warn('[version-effect-preview] frame failed:', err);
    animated = false;
  }
  record(performance.now() - t0);
  return animated;
}

/** `prefers-reduced-motion: reduce`. */
function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
  catch {
    return false;
  }
}

const animator = createEffectAnimator({ draw: drawFrame, fps: 30, reducedMotion: reducedMotion() });

/** (Re)starts the loop unless the document is hidden. */
function restart(): void {
  animator.stop();
  if (typeof document !== 'undefined' && document.hidden) return;
  animator.start();
}

/** Pauses while the tab is hidden. */
function onVisibility(): void {
  if (document.hidden) animator.stop();
  else restart();
}

// A plugin instance became ready / a manifest arrived: retry when static.
watch([previewRevision, pluginRevision], () => {
  if (!animator.running) restart();
});
// Different version / effect: rebuild and restart.
watch(prepared, restart);

onMounted(() => {
  ctx = canvas.value?.getContext('2d') ?? null;
  document.addEventListener('visibilitychange', onVisibility);
  restart();
});

onBeforeUnmount(() => {
  animator.stop();
  document.removeEventListener('visibilitychange', onVisibility);
  releasePreview(instanceKey);
});
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="version-effect-preview">
    <canvas
      ref="canvas"
      role="img"
      :aria-label="title"
      :width="Math.round(width * dpr)"
      :height="Math.round(height * dpr)"
      :style="{ width: `${width}px`, height: `${height}px` }"
      class="block"
    />
    <template v-if="caption">
      <p class="truncate text-xs font-medium" data-testid="effect-title">
        {{ title }}
      </p>
      <p v-if="detail" class="line-clamp-2 text-xs text-muted-foreground" data-testid="effect-detail">
        {{ detail }}
      </p>
    </template>
  </div>
</template>
