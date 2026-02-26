<script setup lang="ts">
import { ref, watchEffect, onMounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Interaction } from './composables/use-selection';
import type { Camera } from './composables/use-camera';

interface Props {
  fixtures: Fixture[];
  colors: Map<string | number, string>;
  interaction: Interaction;
  camera: Camera;
  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

const props = defineProps<Props>();

const canvasEl   = ref<HTMLCanvasElement | null>(null);
const DOT_SPACING = 25;

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
    const r  = (fixture.fixtureSize?.x ?? 1) * 16;

    const margin  = r * 3;
    const screenX = wx * scale + camX;
    const screenY = wy * scale + camY;
    const screenR = margin * scale;

    if (screenX + screenR < 0 || screenX - screenR > props.viewportWidth ||
        screenY + screenR < 0 || screenY - screenR > props.viewportHeight) {
      continue;
    }

    const color = props.colors.get(fixture.id) ?? '#000000';

    const glow = ctx.createRadialGradient(wx, wy, r * 0.3, wx, wy, r * 2.2);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(10,10,10,0)');
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(wx, wy, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
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
watchEffect(draw);
defineExpose({ draw });
</script>

<template>
  <canvas
    ref="canvasEl"
    class="fixture-canvas"
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
