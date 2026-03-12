<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Interaction } from './composables/use-selection';
import type { Camera } from './composables/use-camera';

interface Props {
  fixtures: Fixture[];
  colors: Map<string | number, string>;
  dmxBuffer?: Uint8Array;
  interaction: Interaction;
  camera: Camera;

  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

const props = defineProps<Props>();

const canvasEl   = ref<HTMLCanvasElement | null>(null);
const DOT_SPACING = 25; // 25px per dot. 10 dots = 250px = 1 meter.

function draw() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true })!;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, props.viewportWidth, props.viewportHeight);

  const { x: camX, y: camY, scale } = props.camera;

  // ── 1. Procedural Infinite Grid ────────────────────────────────────────────
  if (scale > 0.4) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    const startX = Math.floor((-camX / scale) / DOT_SPACING) * DOT_SPACING;
    const startY = Math.floor((-camY / scale) / DOT_SPACING) * DOT_SPACING;
    const endX   = startX + (props.viewportWidth  / scale) + DOT_SPACING * 2;
    const endY   = startY + (props.viewportHeight / scale) + DOT_SPACING * 2;

    for (let gx = startX; gx <= endX; gx += DOT_SPACING) {
      for (let gy = startY; gy <= endY; gy += DOT_SPACING) {
        const sx = gx * scale + camX;
        const sy = gy * scale + camY;
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, 1.2 * scale, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  // ── 2. Fixture Rendering with Frustum Culling ──────────────────────────────
  ctx.setTransform(scale, 0, 0, scale, camX, camY);

  for (const fixture of props.fixtures) {
    const wx = fixture.fixturePosition.x * props.worldWidth;
    const wy = fixture.fixturePosition.y * props.worldHeight;
    const fixtureSizeX = fixture.fixtureSize?.x ?? 1;
    const fixtureSizeY = fixture.fixtureSize?.y ?? 1;
    const rX = fixtureSizeX * 16;
    const rY = fixtureSizeY * 16;
    const maxR = Math.max(rX, rY);

    const margin  = maxR * 3;
    const screenX = wx * scale + camX;
    const screenY = wy * scale + camY;
    const screenR = margin * scale;

    if (screenX + screenR < 0 || screenX - screenR > props.viewportWidth ||
        screenY + screenR < 0 || screenY - screenR > props.viewportHeight) {
      continue;
    }

    const color = props.colors.get(fixture.id) ?? '#000000';

    if (fixture.beams && fixture.beams.length > 1) {
      // BASE must match FIXTURE_RADIUS in FixtureEditor.vue (= 18) so canvas
      // beam positions align exactly with the CSS fixture node boundary.
      const BASE = 18;
      const halfW = BASE * fixtureSizeX; // half-width of the fixture footprint in world px
      const halfH = BASE * fixtureSizeY;

      // Physical pixel radius – sized to fill their slot evenly
      let minDistX = 1;
      let minDistY = 1;

      const xs = [...new Set(fixture.beams.map(b => b.localX))].sort((a, b) => a - b);
      const ys = [...new Set(fixture.beams.map(b => b.localY))].sort((a, b) => a - b);
      if (xs.length > 1) minDistX = xs[1]! - xs[0]!;
      if (ys.length > 1) minDistY = ys[1]! - ys[0]!;

      // full fixture width is halfW * 2, so slot width is (halfW * 2) * minDistX
      const slotW = (halfW * 2) * minDistX;
      const slotH = (halfH * 2) * minDistY;
      
      // Radius is half the smallest slot dimension (with 20% margin)
      const pixelR = Math.min(slotW, slotH) / 2 * 0.8;
      const clampedPixelR = Math.max(1.5, pixelR);

      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate((fixture.rotation || 0) * Math.PI / 180);

      // ── Per-beam glow + dot ───────────────────────────────────────────────
      ctx.globalAlpha = 1;
      for (const beam of fixture.beams) {
        // localX/Y is in -0.5..+0.5 → map to fixture footprint (relative to center)
        const bx = beam.localX * halfW * 2;
        const by = beam.localY * halfH * 2;
        const beamColor = fixture.resolveColor(props.dmxBuffer || new Uint8Array(), beam.id);

        // Glow halo for this beam
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, clampedPixelR * 3.5);
        glow.addColorStop(0,   beamColor.replace('rgb', 'rgba').replace(')', ', 0.55)'));
        glow.addColorStop(1,   'rgba(10,10,10,0)');
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = glow;
        ctx.fillRect(bx - clampedPixelR * 3.5, by - clampedPixelR * 3.5,
                     clampedPixelR * 7,         clampedPixelR * 7);

        // Hard dot
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(bx, by, clampedPixelR, 0, Math.PI * 2);
        ctx.fillStyle = beamColor;
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Single head fixture
      ctx.save();
      ctx.translate(wx, wy);
      // Wait, single head fixture can still be visually rotated if it's rectangular...
      // but FixtureNode represents its box, and a single light doesn't change visually 
      // when rotating a perfect circle glow. However, if it's placed differently, we should
      // probably just always rotate.
      ctx.rotate((fixture.rotation || 0) * Math.PI / 180);
      ctx.scale(rX / maxR, rY / maxR);

      const glow = ctx.createRadialGradient(0, 0, maxR * 0.3, 0, 0, maxR * 2.2);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(10,10,10,0)');
      
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, maxR * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(0, 0, maxR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.restore();
    }
  }

  // ── 3. Marquee selection rectangle ────────────────────────────────────────
  if (props.interaction.type === 'marquee') {
    const { start, end } = props.interaction;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);

    ctx.globalAlpha = 1;
    ctx.fillStyle   = 'rgba(251, 191, 36, 0.08)'; // #fbbf24
    ctx.fillRect(x, y, w, h);

    const lw = 1 / scale;
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)'; // #fbbf24
    ctx.lineWidth   = lw;
    ctx.setLineDash([4 * lw, 4 * lw]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

onMounted(draw);

// The 60fps engine loop updates `props.colors` via a shallowRef, making it a perfect trigger.
// We use flush: 'sync' to draw immediately without waiting for Vue's next tick.
watch(() => props.colors, draw, { flush: 'sync' });

// Draw when the camera moves (pan/zoom)
watch(
  [() => props.camera.x, () => props.camera.y, () => props.camera.scale],
  draw,
  { flush: 'sync' }
);

// Draw when marquee selection updates
watch(
  () => props.interaction,
  draw,
  { deep: true, flush: 'sync' }
);

defineExpose({ draw });
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
