<script setup lang="ts">
import { computed, ref, watch, watchEffect, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { getPageResolution } from '~/utils/live/types';
import { useCamera } from '~/components/engine/composables/use-camera';
import LiveWidget from './LiveWidget.vue';
import LiveCollaboratorCursors from './LiveCollaboratorCursors.vue';

const store = useLiveModeStore();
const liveBus = useLiveBusStore();
const { remoteCameras, followedSessionId } = storeToRefs(liveBus);
const { camera, onWheel: cameraOnWheel } = useCamera();

const containerRef = useTemplateRef<HTMLElement>('container');
const canvasRef = useTemplateRef<HTMLElement>('canvas');

const containerW = ref(0);
const containerH = ref(0);

// ── Play-mode letterbox scale ─────────────────────────────────────────────────

const playScale = computed(() => {
  if (!store.activePage || containerW.value === 0) return 1;
  const { w, h } = getPageResolution(store.activePage);
  return Math.min(containerW.value / w, containerH.value / h);
});

// ── Camera helpers ─────────────────────────────────────────────────────────────

function centerCanvasInViewport() {
  if (!store.activePage || containerW.value === 0) return;
  const { w, h } = getPageResolution(store.activePage);
  const s = Math.min(containerW.value / w, containerH.value / h) * 0.85;
  camera.scale = s;
  camera.x = (containerW.value - w * s) / 2;
  camera.y = (containerH.value - h * s) / 2;
}

// Center camera when entering edit mode
watch(() => store.editMode, (editMode) => {
  if (editMode) centerCanvasInViewport();
});

// Recenter when page dimensions change (in edit mode)
watch(
  () => [store.activePage?.columns, store.activePage?.aspectRatioW, store.activePage?.aspectRatioH, store.activePage?.gridSize],
  () => { if (store.editMode) centerCanvasInViewport(); },
);

// ── Camera collaboration sync ──────────────────────────────────────────────────
// Mirror followed user's camera (only when following someone in live mode on
// the same page). Broadcast our own camera otherwise so followers can mirror it.

watchEffect(() => {
  if (!store.editMode) return;
  const sid = followedSessionId.value;
  if (!sid) return;
  const remote = remoteCameras.value.get(sid);
  if (!remote) return;
  if (remote.context !== 'live') return;
  if (store.activePage && remote.livePageId && remote.livePageId !== store.activePage.id) return;
  if (camera.x !== remote.x) camera.x = remote.x;
  if (camera.y !== remote.y) camera.y = remote.y;
  if (camera.scale !== remote.scale) camera.scale = remote.scale;
});

watch(
  () => [camera.x, camera.y, camera.scale],
  () => {
    if (!store.editMode) return;
    if (followedSessionId.value) return; // mirroring, don't echo
    liveBus.dispatch('camera.sync', {
      x: camera.x,
      y: camera.y,
      scale: camera.scale,
      context: 'live',
      livePageId: store.activePage?.id,
    });
  },
);

// ── Canvas styles ─────────────────────────────────────────────────────────────

const canvasStyle = computed(() => {
  if (!store.activePage) return {};
  const { w, h } = getPageResolution(store.activePage);

  let tx: number, ty: number, s: number;
  if (store.editMode) {
    tx = camera.x; ty = camera.y; s = camera.scale;
  } else {
    s = playScale.value;
    tx = (containerW.value - w * s) / 2;
    ty = (containerH.value - h * s) / 2;
  }

  return {
    width: `${w}px`,
    height: `${h}px`,
    backgroundColor: store.activePage.backgroundColor,
    transform: `translate(${tx}px, ${ty}px) scale(${s})`,
    transformOrigin: '0 0',
    position: 'absolute' as const,
    top: '0',
    left: '0',
  };
});

const gridStyle = computed(() => {
  if (!store.activePage || !store.editMode) return {};
  const gs = store.activePage.gridSize;
  return {
    backgroundImage: `
      linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)
    `,
    backgroundSize: `${gs}px ${gs}px`,
  };
});

// ── Wheel handler ─────────────────────────────────────────────────────────────

function handleWheel(event: WheelEvent) {
  if (!store.editMode || !containerRef.value) return;
  liveBus.followedSessionId = null; // user-initiated viewport change → stop following
  const rect = containerRef.value.getBoundingClientRect();
  cameraOnWheel(event, rect);
}

// ── Middle-mouse pan ──────────────────────────────────────────────────────────

let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartCamX = 0, panStartCamY = 0;

function handleMouseDown(e: MouseEvent) {
  if (e.button === 1 && store.editMode) {
    liveBus.followedSessionId = null; // user-initiated pan → stop following
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartCamX = camera.x;
    panStartCamY = camera.y;
    e.preventDefault();
  }
}

function handleMouseMove(e: MouseEvent) {
  if (isPanning) {
    camera.x = panStartCamX + (e.clientX - panStartX);
    camera.y = panStartCamY + (e.clientY - panStartY);
  }
}

function handleMouseUp(e: MouseEvent) {
  if (e.button === 1) isPanning = false;
}

// ── Cursor tracking ───────────────────────────────────────────────────────────

let cachedRectLeft = 0;
let cachedRectTop = 0;
let inLiveArea = false;
let queuedClientX = 0;
let queuedClientY = 0;
let rafQueued = false;

function refreshCachedRect() {
  if (!canvasRef.value) return;
  const r = canvasRef.value.getBoundingClientRect();
  cachedRectLeft = r.left;
  cachedRectTop = r.top;
}

function flushCursor() {
  rafQueued = false;
  if (!store.editMode || !store.activePage) return;
  const s = camera.scale;
  if (s === 0) return;
  const localX = (queuedClientX - cachedRectLeft) / s;
  const localY = (queuedClientY - cachedRectTop) / s;
  liveBus.dispatch('cursor.move', {
    wx: localX,
    wy: localY,
    context: 'live',
    livePageId: store.activePage.id,
  });
}

function onDocPointerMove(e: PointerEvent) {
  if (!inLiveArea) return;
  queuedClientX = e.clientX;
  queuedClientY = e.clientY;
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(flushCursor);
  }
}

function onContainerEnter() { inLiveArea = true; }
function onContainerLeave() { inLiveArea = false; }

// ── Resize observer ───────────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null;
let mountedContainer: HTMLElement | null = null;

onMounted(() => {
  mountedContainer = containerRef.value;
  if (mountedContainer) {
    resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        const firstMeasure = containerW.value === 0;
        containerW.value = width;
        containerH.value = height;
        if (firstMeasure && store.editMode) centerCanvasInViewport();
      }
      refreshCachedRect();
    });
    resizeObserver.observe(mountedContainer);
    mountedContainer.addEventListener('pointerenter', onContainerEnter);
    mountedContainer.addEventListener('pointerleave', onContainerLeave);
    mountedContainer.addEventListener('mousedown', handleMouseDown);
    mountedContainer.addEventListener('mousemove', handleMouseMove);
    mountedContainer.addEventListener('mouseup', handleMouseUp);
  }
  document.addEventListener('pointermove', onDocPointerMove, { passive: true });
  window.addEventListener('scroll', refreshCachedRect, { passive: true, capture: true });
  window.addEventListener('resize', refreshCachedRect);

});

onUnmounted(() => {
  resizeObserver?.disconnect();
  mountedContainer?.removeEventListener('pointerenter', onContainerEnter);
  mountedContainer?.removeEventListener('pointerleave', onContainerLeave);
  mountedContainer?.removeEventListener('mousedown', handleMouseDown);
  mountedContainer?.removeEventListener('mousemove', handleMouseMove);
  mountedContainer?.removeEventListener('mouseup', handleMouseUp);
  mountedContainer = null;
  document.removeEventListener('pointermove', onDocPointerMove);
  window.removeEventListener('scroll', refreshCachedRect, { capture: true } as any);
  window.removeEventListener('resize', refreshCachedRect);
});

watch(
  () => [camera.scale, camera.x, camera.y, store.activePage?.id],
  () => { requestAnimationFrame(refreshCachedRect); },
);
</script>

<template>
  <div
    ref="container"
    class="absolute inset-0 overflow-hidden"
    :class="store.editMode ? 'bg-black/40' : 'bg-black/80'"
    @wheel.prevent="handleWheel"
    @dragstart.prevent
  >
    <div v-if="!store.activePage" class="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
      No page — add one below.
    </div>

    <div
      v-else
      ref="canvas"
      :style="{ ...canvasStyle, ...gridStyle }"
    >
      <LiveWidget
        v-for="widget in store.activePage.widgets"
        :key="widget.id"
        :widget="widget"
        :page-id="store.activePage.id"
        :grid-size="store.activePage.gridSize"
        :edit-mode="store.editMode"
        :canvas-scale="camera.scale"
      />
      <LiveCollaboratorCursors v-if="store.editMode" :page-id="store.activePage.id" :scale="camera.scale" />
    </div>
  </div>
</template>
