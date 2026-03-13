<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Interaction } from './composables/use-selection';
import type { Camera } from './composables/use-camera';
import type { EffectEngine } from '~/utils/engine/engine';

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

// Pull dmxBuffer directly from the engine — never via prop (prop is captured at render time,
// effectEngine.dmxBuffer is reassigned after async WASM init and after each render call).
const effectEngine = inject<EffectEngine | undefined>('effectEngine');

// Plain JS variable — intentionally bypasses Vue's reactivity proxy.
let wasmCanvas: WasmCanvas | null = null;
const canvasEl = ref<HTMLCanvasElement | null>(null);
let rafId: number | null = null;

// ─── Sync: Camera / Viewport / Marquee (CHEAP — called every RAF frame, no JSON) ──────────────
function syncState() {
  const wc = wasmCanvas;
  if (!wc) return;

  wc.set_camera(props.camera.x, props.camera.y, props.camera.scale);
  wc.set_viewport(props.viewportWidth, props.viewportHeight);
  wc.set_world(props.worldWidth, props.worldHeight);

  if (props.interaction.type === 'marquee') {
    const { start, end } = props.interaction;
    wc.set_marquee(true, start.x, start.y, end.x, end.y);
  } else {
    wc.set_marquee(false, 0, 0, 0, 0);
  }
}

// ─── Sync: Fixture geometry + DMX channel indices (EXPENSIVE — JSON + R-Tree rebuild) ─────────
function syncFixtures() {
  const wc = wasmCanvas;
  if (!wc) return;

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
      worldX: f.fixturePosition.x,
      worldY: f.fixturePosition.y,
      width: f.fixtureSize?.x ?? 1,
      height: f.fixtureSize?.y ?? 1,
      rotation: f.rotation || 0,
      selected: isSelected(f),
      channelStart: f.startAddress,
      rIndex:      chIdx('RED'),
      gIndex:      chIdx('GREEN'),
      bIndex:      chIdx('BLUE'),
      dimmerIndex: chIdx('DIMMER'),
      beams: f.beams.map(b => ({
        id: String(b.id),
        localX: b.localX,
        localY: b.localY,
        rIndex:      chIdx('RED',    String(b.id)),
        gIndex:      chIdx('GREEN',  String(b.id)),
        bIndex:      chIdx('BLUE',   String(b.id)),
        dimmerIndex: chIdx('DIMMER', String(b.id)),
      })),
    };
  });

  try {
    wc.sync_fixtures(JSON.stringify(canvasFixtures));
  } catch (err) {
    console.error('rs-engine-canvas sync_fixtures failed:', err);
  }
}

// ─── Sync: Selection state only (CHEAP — no JSON, no R-Tree rebuild) ──────────────────────────
function syncSelected() {
  const wc = wasmCanvas;
  if (!wc) return;
  // Expand: include fixture IDs whose ancestor is in selectedIds
  const arr = props.fixtures
    .filter(f => { let c: any = f; while (c) { if (props.selectedIds.has(c.id)) return true; c = c.parent; } return false; })
    .map(f => String(f.id));
  wc.set_selected(arr);
}

// ─── Draw: pull dmxBuffer directly from engine (live WASM memory view) ────────────────────────
function drawFrame() {
  if (wasmCanvas) {
    wasmCanvas.draw(effectEngine?.dmxBuffer ?? new Uint8Array());
  }
}

// ─── RAF loop: syncState (cheap) + draw every frame ───────────────────────────────────────────
function startRafLoop() {
  const loop = () => {
    syncState();
    drawFrame();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// ─── Init ─────────────────────────────────────────────────────────────────────────────────────
async function initAndDraw() {
  await initWasm(wasmUrl);
  if (!canvasEl.value) return;

  const wc = new WasmCanvas();
  try {
    wc.init_gl(canvasEl.value!);
    wasmCanvas = wc;
    syncState();    // ensure world dimensions are set before R-Tree build
    syncFixtures(); // initial fixture geometry + selection sync
    startRafLoop();
  } catch (error) {
    console.error('Failed to initialize WebGL femtovg canvas:', error);
  }
}

onMounted(() => {
  initAndDraw();
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (wasmCanvas) {
    wasmCanvas.free();
    wasmCanvas = null;
  }
});

// ─── Watches ──────────────────────────────────────────────────────────────────────────────────
// Camera/viewport/marquee are synced every RAF frame via syncState() — no watches needed.
// Re-sync fixtures when added/removed (expensive JSON + R-Tree rebuild).
watch(() => props.fixtures.length, syncFixtures);
// Re-sync selection cheaply (set_selected only, no R-Tree rebuild).
watch(() => props.selectedIds, syncSelected);

// ─── Public API ───────────────────────────────────────────────────────────────────────────────
defineExpose({
  // sync() is called from handleMouseMove during drag to push updated fixture positions
  sync: syncFixtures,
  draw: drawFrame,
  hitTest: (x: number, y: number) => wasmCanvas?.hit_test(x, y),
  hitTestRotationZone: (x: number, y: number) => wasmCanvas?.hit_test_rotation_zone(x, y),
  marqueeSelect: (sx: number, sy: number, ex: number, ey: number) => wasmCanvas?.marquee_select(sx, sy, ex, ey),
});
</script>

<template>
  <canvas
    ref="canvasEl"
    class="fixture-canvas rounded-none"
    :width="viewportWidth"
    :height="viewportHeight"
  />
</template>

<style scoped>
.fixture-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
