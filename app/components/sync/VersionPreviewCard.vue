<script lang="ts">
/** Session-wide: the WebGL renderer failed once → SVG from then on. */
let wasmUnavailable = false;
</script>

<script setup lang="ts">
/**
 * Hover preview of one version-history entry: the snapshot's layout drawn
 * live with the workspace renderer (rs-engine-canvas on a shared main-thread
 * WebGL canvas, `preview-wasm.ts`), or as SVG when WebGL/WASM is unavailable.
 * Loads on mount and cancels the request on unmount (the panel mounts the
 * card only while the entry is shown). Caption: time + summary.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime, relativeTime } from '~/utils/sync/relative-time';
import { formatSummary, snapshotBadge } from '~/utils/sync/version-history';
import type { VersionPreview } from '~/utils/sync/version-preview/preview-controller';
import type { PreviewModel } from '~/utils/sync/version-preview/preview-model';
import { toSvgScene } from '~/utils/sync/version-preview/preview-svg';
import VersionPreviewSchematic from '~/components/sync/VersionPreviewSchematic.vue';
import { LoaderCircle } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  preview: VersionPreview;
  entry: SnapshotListEntry;
  now: number;
  /** `svg` skips the WebGL renderer (tests, forced fallback). */
  renderer?: 'auto' | 'svg';
}>(), { renderer: 'auto' });

/** Preview viewport in CSS px. */
const WIDTH = 320;
const HEIGHT = 200;

const state = computed(() => props.preview.state(props.entry.id).value);
const model = computed(() => state.value.model);
const canvasEl = ref<HTMLCanvasElement | null>(null);
/** Rendering path actually used for the current model. */
const mode = ref<'pending' | 'canvas' | 'svg'>('pending');
/** Last render time in ms (data attribute for measurements). */
const renderMs = ref<number | null>(null);
const svgScene = shallowRef<ReturnType<typeof toSvgScene> | null>(null);

const caption = computed(() => {
  const ms = Date.parse(props.entry.createdAt);
  return {
    badge: snapshotBadge(props.entry.label).text,
    when: relativeTime(ms, props.now),
    absolute: absoluteTime(ms),
    summary: formatSummary(props.entry.summary),
  };
});

/** Draws `m` with WebGL when possible, else as SVG; records the render time. */
async function render(m: PreviewModel): Promise<void> {
  if (props.renderer === 'auto' && !wasmUnavailable) {
    mode.value = 'canvas';
    await nextTick();
    try {
      const { renderWasmPreview } = await import('~/utils/sync/version-preview/preview-wasm');
      const el = canvasEl.value;
      // Model changed or card closed meanwhile: nothing to draw.
      if (!el || model.value !== m) return;
      el.style.width = `${WIDTH}px`;
      el.style.height = `${HEIGHT}px`;
      const ms = await renderWasmPreview(el, m, WIDTH, HEIGHT, window.devicePixelRatio || 1);
      if (ms !== null) {
        renderMs.value = ms;
        return;
      }
    }
    catch (err) {
      console.warn('[version-preview] WebGL renderer failed to load:', err);
    }
    wasmUnavailable = true;
  }
  const t0 = performance.now();
  svgScene.value = toSvgScene(m, WIDTH, HEIGHT);
  mode.value = 'svg';
  await nextTick();
  renderMs.value = performance.now() - t0;
}

watch(model, (m) => { if (m) void render(m); }, { immediate: true });
onMounted(() => { void props.preview.load(props.entry.id); });
onBeforeUnmount(() => props.preview.cancel(props.entry.id));
</script>

<template>
  <div
    class="w-[338px] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
    role="tooltip"
    :aria-label="`Preview of the version from ${caption.absolute}`"
    data-testid="version-preview-card"
    :data-render-ms="renderMs !== null ? renderMs.toFixed(1) : undefined"
    :data-render-mode="mode"
  >
    <div class="relative flex h-[200px] w-[320px] items-center justify-center overflow-hidden rounded bg-zinc-950">
      <template v-if="model">
        <canvas v-if="mode === 'canvas'" ref="canvasEl" class="block" data-testid="version-preview-canvas" />
        <VersionPreviewSchematic v-else-if="mode === 'svg' && svgScene" :scene="svgScene" />
        <p v-if="!model.fixtures.length" class="absolute text-[11px] text-zinc-400">Empty project</p>
      </template>
      <p v-else-if="state.status === 'offline'" class="text-[11px] text-zinc-400" data-testid="version-preview-offline">Preview needs a connection.</p>
      <p v-else-if="state.status === 'error'" class="text-[11px] text-zinc-400" data-testid="version-preview-error">{{ state.error }}</p>
      <LoaderCircle v-else :size="16" class="animate-spin text-zinc-400" aria-label="Loading preview" />
    </div>
    <p class="mt-1.5 truncate text-[11px] font-medium">{{ caption.badge }} · {{ caption.when }}</p>
    <p class="truncate text-[11px] text-muted-foreground">
      {{ caption.summary }}<template v-if="model?.hidden"> · {{ model.hidden }} more not shown</template>
    </p>
  </div>
</template>
