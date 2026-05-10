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

// ── Middle-mouse pan + marquee selection ─────────────────────────────────────

let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartCamX = 0, panStartCamY = 0;

// Marquee state, in canvas-local pixels (so it scales with camera)
const marquee = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
let marqueeStartShift = false;
let marqueePrevSelection: Set<string> = new Set();

function clientToCanvasLocal(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!canvasRef.value) return null;
  const rect = canvasRef.value.getBoundingClientRect();
  const s = camera.scale || 1;
  return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
}

function handleMouseDown(e: MouseEvent) {
  // Middle-mouse pan
  if (e.button === 1 && store.editMode) {
    liveBus.followedSessionId = null;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartCamX = camera.x;
    panStartCamY = camera.y;
    e.preventDefault();
    return;
  }

  // Left-click on empty canvas → start marquee selection + exit any group isolation.
  // We only get here when no LiveWidget intercepted the event (each widget
  // calls e.stopPropagation() in its own mousedown).
  if (e.button === 0 && store.editMode && store.activePage) {
    const local = clientToCanvasLocal(e.clientX, e.clientY);
    if (!local) return;
    if (store.isolatedGroupId !== null) store.exitIsolation();
    marqueeStartShift = e.shiftKey || e.metaKey || e.ctrlKey;
    marqueePrevSelection = marqueeStartShift ? new Set(store.selectedWidgetIds) : new Set();
    if (!marqueeStartShift) store.selectedWidgetIds = new Set();
    marquee.value = { x1: local.x, y1: local.y, x2: local.x, y2: local.y };
  }
}

function handleMouseMove(e: MouseEvent) {
  if (isPanning) {
    camera.x = panStartCamX + (e.clientX - panStartX);
    camera.y = panStartCamY + (e.clientY - panStartY);
    return;
  }
  if (marquee.value) {
    const local = clientToCanvasLocal(e.clientX, e.clientY);
    if (!local || !store.activePage) return;
    marquee.value = { ...marquee.value, x2: local.x, y2: local.y };

    // Recompute selection: every widget whose box intersects the marquee.
    const m = marquee.value;
    const minX = Math.min(m.x1, m.x2);
    const maxX = Math.max(m.x1, m.x2);
    const minY = Math.min(m.y1, m.y2);
    const maxY = Math.max(m.y1, m.y2);
    const gs = store.activePage.gridSize;

    const next = new Set(marqueePrevSelection);
    const added = new Set<string>();
    for (const w of store.activePage.widgets) {
      const wx1 = w.gridX * gs;
      const wy1 = w.gridY * gs;
      const wx2 = wx1 + w.gridW * gs;
      const wy2 = wy1 + w.gridH * gs;
      const intersects = wx1 < maxX && wx2 > minX && wy1 < maxY && wy2 > minY;
      if (intersects) added.add(w.id);
    }
    // Group-aware: if any selected widget belongs to a group, pull in its peers.
    const groupIds = new Set<string>();
    for (const id of added) {
      const w = store.activePage.widgets.find(x => x.id === id);
      if (w?.groupId) groupIds.add(w.groupId);
    }
    for (const w of store.activePage.widgets) {
      if (w.groupId && groupIds.has(w.groupId)) added.add(w.id);
    }
    for (const id of added) next.add(id);
    store.selectedWidgetIds = next;
  }
}

function handleMouseUp(e: MouseEvent) {
  if (e.button === 1) isPanning = false;
  if (e.button === 0 && marquee.value) {
    marquee.value = null;
    marqueePrevSelection = new Set();
  }
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

      <!-- Marquee selection rectangle (canvas-local pixel coords) -->
      <div
        v-if="marquee"
        class="absolute pointer-events-none border border-primary bg-primary/15"
        :style="{
          left: `${Math.min(marquee.x1, marquee.x2)}px`,
          top: `${Math.min(marquee.y1, marquee.y2)}px`,
          width: `${Math.abs(marquee.x2 - marquee.x1)}px`,
          height: `${Math.abs(marquee.y2 - marquee.y1)}px`,
          zIndex: 9000,
        }"
      />
    </div>
  </div>
</template>
