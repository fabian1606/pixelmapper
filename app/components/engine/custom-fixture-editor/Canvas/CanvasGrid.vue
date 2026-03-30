<script setup lang="ts">
defineProps<{
  gridPx: number;
  worldPx: number;
  cx: number;
  cy: number;
}>();
</script>

<template>
  <g>
    <defs>
      <!-- Fine dot grid: every 10 cm -->
      <pattern id="cf-dot-sm" :width="gridPx" :height="gridPx" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1.2" fill="rgba(255,255,255,0.13)" />
      </pattern>
      <!-- Accent dot grid: every 50 cm -->
      <pattern id="cf-dot-lg" :width="gridPx*5" :height="gridPx*5" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="2" fill="rgba(255,255,255,0.28)" />
      </pattern>
    </defs>

    <rect width="100%" height="100%" fill="url(#cf-dot-sm)" />
    <rect width="100%" height="100%" fill="url(#cf-dot-lg)" />

    <!-- Centre crosshair -->
    <line :x1="0" :y1="cy" :x2="worldPx" :y2="cy" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4 8" />
    <line :x1="cx" :y1="0" :x2="cx" :y2="worldPx" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4 8" />
  </g>
</template>
