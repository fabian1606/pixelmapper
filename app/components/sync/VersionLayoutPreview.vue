<script lang="ts">
/** Session-wide: the WebGL renderer failed once → SVG from then on. */
let wasmUnavailable = false;
</script>

<script setup lang="ts">
/**
 * Layout of a version in the hover preview card: drawn with the workspace
 * renderer (rs-engine-canvas on a shared main-thread WebGL canvas,
 * `preview-wasm.ts`), or as SVG when WebGL/WASM is unavailable. Optional
 * highlight rings (changed / moved / added fixtures) are drawn as an SVG
 * overlay with the same camera (`highlight-map.ts`).
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import type { HighlightRing } from '~/utils/sync/version-preview/highlight-map';
import type { PreviewModel } from '~/utils/sync/version-preview/preview-model';
import { toSvgScene } from '~/utils/sync/version-preview/preview-svg';
import VersionPreviewSchematic from '~/components/sync/VersionPreviewSchematic.vue';

const props = withDefaults(defineProps<{
  model: PreviewModel;
  /** `svg` skips the WebGL renderer (tests, forced fallback). */
  renderer?: 'auto' | 'svg';
  rings?: HighlightRing[];
  width?: number;
  height?: number;
}>(), { renderer: 'auto', rings: () => [], width: 320, height: 200 });

const emit = defineEmits<{ rendered: [ms: number, mode: 'canvas' | 'svg'] }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
/** Rendering path actually used for the current model. */
const mode = ref<'pending' | 'canvas' | 'svg'>('pending');
const svgScene = shallowRef<ReturnType<typeof toSvgScene> | null>(null);

/** Draws `m` with WebGL when possible, else as SVG; reports the render time. */
async function render(m: PreviewModel): Promise<void> {
  if (props.renderer === 'auto' && !wasmUnavailable) {
    mode.value = 'canvas';
    await nextTick();
    try {
      const { renderWasmPreview } = await import('~/utils/sync/version-preview/preview-wasm');
      const el = canvasEl.value;
      // Model changed or card closed meanwhile: nothing to draw.
      if (!el || props.model !== m) return;
      el.style.width = `${props.width}px`;
      el.style.height = `${props.height}px`;
      const ms = await renderWasmPreview(el, m, props.width, props.height, window.devicePixelRatio || 1);
      if (ms !== null) {
        emit('rendered', ms, 'canvas');
        return;
      }
    }
    catch (err) {
      console.warn('[version-preview] WebGL renderer failed to load:', err);
    }
    wasmUnavailable = true;
  }
  const t0 = performance.now();
  svgScene.value = toSvgScene(m, props.width, props.height);
  mode.value = 'svg';
  await nextTick();
  emit('rendered', performance.now() - t0, 'svg');
}

watch(() => props.model, m => void render(m), { immediate: true });

const empty = computed(() => !props.model.fixtures.length);
</script>

<template>
  <div class="relative flex items-center justify-center" :style="{ width: `${width}px`, height: `${height}px` }" :data-render-mode="mode">
    <canvas v-if="mode === 'canvas'" ref="canvasEl" class="block" data-testid="version-preview-canvas" />
    <VersionPreviewSchematic v-else-if="mode === 'svg' && svgScene" :scene="svgScene" />
    <svg
      v-if="rings.length"
      class="pointer-events-none absolute inset-0"
      :width="width"
      :height="height"
      aria-hidden="true"
      data-testid="version-preview-rings"
    >
      <rect
        v-for="(r, i) in rings"
        :key="i"
        :x="r.x" :y="r.y" :width="r.width" :height="r.height" rx="4"
        fill="none" :stroke="r.color" stroke-width="1.5"
        :data-mark="r.mark"
      />
    </svg>
    <p v-if="empty" class="absolute text-[11px] text-zinc-400">Empty project</p>
  </div>
</template>
