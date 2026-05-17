<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Interaction } from './composables/use-selection';
import type { Camera } from './composables/use-camera';
import type { EffectEngine } from '~/utils/engine/engine';
import { useEngineStore } from '~/stores/engine-store';

import initWasm, { WasmCanvas } from 'rs-engine-canvas';
import wasmUrl from 'rs-engine-canvas/rs_engine_canvas_bg.wasm?url';

interface Props {
  fixtures: Fixture[];
  selectedIds: Set<string | number>;
  interaction: Interaction;
  camera: Camera;

  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

const props = defineProps<Props>();

// Engine holds the worker that owns the OffscreenCanvas (drawing happens there).
const effectEngine = inject<EffectEngine | undefined>('effectEngine');
const engineStore = useEngineStore();

// Local WasmCanvas — NO init_gl. Used only for hit-test / marquee-select on
// the main thread so input handlers stay synchronous. State (camera, viewport,
// world, fixtures, marquee, selected) is mirrored from the worker side.
let localCanvas: WasmCanvas | null = null;
const canvasEl = ref<HTMLCanvasElement | null>(null);
let rafId: number | null = null;
let canvasTransferred = false;

// ─── Sync: Camera / Viewport / Marquee (every RAF — cheap postMessages + local mirror) ──────
function syncState() {
  if (!effectEngine) return;
  effectEngine.setCanvasCamera(props.camera.x, props.camera.y, props.camera.scale);
  effectEngine.setCanvasViewport(props.viewportWidth, props.viewportHeight);
  effectEngine.setCanvasWorld(props.worldWidth, props.worldHeight);

  if (props.interaction.type === 'marquee') {
    const { start, end } = props.interaction;
    effectEngine.setCanvasMarquee(true, start.x, start.y, end.x, end.y);
  } else {
    effectEngine.setCanvasMarquee(false, 0, 0, 0, 0);
  }

  // Mirror to local canvas for hit-testing
  if (localCanvas) {
    localCanvas.set_camera(props.camera.x, props.camera.y, props.camera.scale);
    localCanvas.set_viewport(props.viewportWidth, props.viewportHeight);
    localCanvas.set_world(props.worldWidth, props.worldHeight);
    if (props.interaction.type === 'marquee') {
      const { start, end } = props.interaction;
      localCanvas.set_marquee(true, start.x, start.y, end.x, end.y);
    } else {
      localCanvas.set_marquee(false, 0, 0, 0, 0);
    }
  }
}

// ─── Sync: Fixture geometry + DMX channel indices (EXPENSIVE — JSON + R-Tree rebuild) ─────────
function syncFixtures() {
  if (!effectEngine) return;

  const isSelected = (f: Fixture): boolean => {
    let c: any = f;
    while (c) { if (props.selectedIds.has(c.id)) return true; c = c.parent; }
    return false;
  };

  const canvasFixtures = props.fixtures.map(f => {
    const dmxIdx = (offset: number) => f.startAddress - 1 + offset;
    const chIdx = (type: string, beamId?: string) => {
      const ch = f.channels.find(c => c.type === type && (!beamId ? !c.beamId : c.beamId === beamId))
        ?? (beamId ? f.channels.find(c => c.type === type && !c.beamId) : undefined);
      return ch != null ? dmxIdx(ch.addressOffset) : null;
    };
    return {
      id: String(f.id),
      name: String(f.name),
      worldX: f.fixturePosition.x,
      worldY: f.fixturePosition.y,
      width: f.fixtureSize?.x ?? 1,
      height: f.fixtureSize?.y ?? 1,
      rotation: f.rotation || 0,
      selected: isSelected(f),
      svg: f.definition?.pixelmapper?.customSvg?.enabled ? (f.definition?.pixelmapper?.customSvg?.data ?? null) : null,
      channelStart: f.startAddress,
      rIndex:      chIdx('RED'),
      gIndex:      chIdx('GREEN'),
      bIndex:      chIdx('BLUE'),
      dimmerIndex: chIdx('DIMMER'),
      beams: f.beams.map(b => ({
        id: String(b.id),
        localX: b.localX,
        localY: b.localY,
        svgElementId: f.definition?.pixelmapper?.customSvg?.headToElement?.[b.id] ?? null,
        rIndex:      chIdx('RED',    String(b.id)),
        gIndex:      chIdx('GREEN',  String(b.id)),
        bIndex:      chIdx('BLUE',   String(b.id)),
        dimmerIndex: chIdx('DIMMER', String(b.id)),
      })),
    };
  });

  const json = JSON.stringify(canvasFixtures);
  effectEngine.syncCanvasFixtures(json);
  if (localCanvas) {
    try { localCanvas.sync_fixtures(json); } catch (err) {
      console.error('rs-engine-canvas (local) sync_fixtures failed:', err);
    }
  }
}

// ─── Sync: Selection state only (CHEAP — no JSON, no R-Tree rebuild) ──────────────────────────
function syncSelected() {
  if (!effectEngine) return;
  const arr = props.fixtures
    .filter(f => { let c: any = f; while (c) { if (props.selectedIds.has(c.id)) return true; c = c.parent; } return false; })
    .map(f => String(f.id));
  effectEngine.setCanvasSelected(arr);
  if (localCanvas) localCanvas.set_selected(arr);
}

// ─── RAF loop: state sync only (drawing happens in the worker, off the main thread) ──────────
function startRafLoop() {
  const loop = () => {
    syncState();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// ─── Init ─────────────────────────────────────────────────────────────────────────────────────
async function initAndDraw() {
  // Local WasmCanvas for hit-test only — no GL needed.
  await initWasm(wasmUrl);
  if (!canvasEl.value || !effectEngine) return;

  localCanvas = new WasmCanvas();

  // Hand the canvas drawing surface to the worker so rendering runs off-main.
  // After transfer the HTMLCanvas's width/height attributes become read-only,
  // so set them once here (initial size) and route subsequent resizes through
  // a worker message that mutates OffscreenCanvas.width/height directly.
  if (!canvasTransferred && 'transferControlToOffscreen' in canvasEl.value) {
    try {
      await effectEngine.ready;
      canvasEl.value.width = props.viewportWidth;
      canvasEl.value.height = props.viewportHeight;
      const offscreen = canvasEl.value.transferControlToOffscreen();
      effectEngine.initCanvas(offscreen);
      canvasTransferred = true;
    } catch (e) {
      console.error('[FixtureCanvas] transferControlToOffscreen failed:', e);
    }
  }

  syncState();    // initial dimensions before R-Tree builds
  syncFixtures(); // initial fixture geometry + selection sync
  startRafLoop();
}

onMounted(() => {
  initAndDraw();
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (localCanvas) {
    localCanvas.free();
    localCanvas = null;
  }
});

// ─── Watches ──────────────────────────────────────────────────────────────────────────────────
watch(() => props.fixtures.length, syncFixtures);
watch(() => props.selectedIds, syncSelected);
// Resize: HTMLCanvas's width/height is frozen after transferControlToOffscreen,
// so push viewport changes to the worker which mutates OffscreenCanvas directly.
watch(() => [props.viewportWidth, props.viewportHeight], ([w, h]) => {
  effectEngine?.resizeCanvas(w as number, h as number);
});

// ─── Public API ───────────────────────────────────────────────────────────────────────────────
function syncRemoteSelections(entries: Array<{ id: string; r: number; g: number; b: number }>) {
  if (!effectEngine) return;
  const json = JSON.stringify(entries);
  effectEngine.setCanvasRemoteSelections(json);
  if (localCanvas) localCanvas.set_remote_selections(json);
}

defineExpose({
  // Hit-tests run synchronously against the local WasmCanvas mirror.
  sync: syncFixtures,
  draw: () => {}, // no-op: worker draws on its own tick
  syncRemoteSelections,
  hitTest: (x: number, y: number) => localCanvas?.hit_test(x, y),
  hitTestRotationZone: (x: number, y: number) => localCanvas?.hit_test_rotation_zone(x, y),
  marqueeSelect: (sx: number, sy: number, ex: number, ey: number) => localCanvas?.marquee_select(sx, sy, ex, ey),
});
</script>

<template>
  <div class="relative w-full h-full pointer-events-none">
    <!-- width/height set imperatively before transferControlToOffscreen() —
         a reactive :width/:height binding would throw after transfer. -->
    <canvas
      ref="canvasEl"
      class="absolute inset-0 rounded-none mix-blend-screen"
    />
  </div>
</template>
