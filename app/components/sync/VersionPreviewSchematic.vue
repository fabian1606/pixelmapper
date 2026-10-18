<script setup lang="ts">
/**
 * SVG fallback of the version-history hover preview: draws the scene from
 * `toSvgScene` (fixtures like the workspace canvas: single heads as filled
 * ellipses, pixel bars as rings with dots, kind fixtures as tinted boxes;
 * dashed group outlines). Used when the WebGL renderer is unavailable.
 */
import type { SvgScene } from '~/utils/sync/version-preview/preview-svg';
import { RING_COLOR } from '~/utils/sync/version-preview/preview-svg';

defineProps<{ scene: SvgScene }>();
</script>

<template>
  <svg
    :width="scene.width"
    :height="scene.height"
    :viewBox="`0 0 ${scene.width} ${scene.height}`"
    class="block"
    role="img"
    aria-label="Layout preview"
    data-testid="version-preview-svg"
  >
    <g :transform="scene.transform">
      <rect
        v-for="(o, i) in scene.outlines"
        :key="`g${i}`"
        :x="o.x" :y="o.y" :width="o.width" :height="o.height"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        :stroke-width="scene.outlineStroke"
        :stroke-dasharray="`${scene.outlineStroke * 4} ${scene.outlineStroke * 3}`"
      >
        <title v-if="o.name">{{ o.name }}</title>
      </rect>
      <template v-for="(s, i) in scene.shapes" :key="i">
        <ellipse
          v-if="s.type === 'ellipse'"
          :cx="s.cx" :cy="s.cy" :rx="s.rx" :ry="s.ry"
          :fill="s.fill" :stroke="RING_COLOR" :stroke-width="scene.stroke"
          :transform="s.transform || undefined"
        />
        <g v-else-if="s.type === 'bar'" :transform="s.transform || undefined">
          <rect :x="s.x" :y="s.y" :width="s.width" :height="s.height" :rx="s.radius" fill="none" :stroke="RING_COLOR" :stroke-width="scene.stroke" />
          <circle v-for="(d, j) in s.dots" :key="j" :cx="d.cx" :cy="d.cy" :r="d.r" :fill="d.fill" />
        </g>
        <rect
          v-else
          :x="s.x" :y="s.y" :width="s.width" :height="s.height" :rx="s.radius"
          :fill="s.fill" fill-opacity="0.35" :stroke="s.fill" :stroke-width="scene.stroke * 0.75"
          :transform="s.transform || undefined"
        />
      </template>
    </g>
  </svg>
</template>
