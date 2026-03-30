<script setup lang="ts">
interface Pt { cx: number; cy: number; }

defineProps<{
  cx: number;
  cy: number;
  totalW: number;
  totalH: number;
  pixels: Pt[];
  pixelR: number;
}>();
</script>

<template>
  <g>
    <rect
      :x="cx - totalW/2 - 4" :y="cy - totalH/2 - 4"
      :width="totalW + 8"     :height="totalH + 8"
      rx="6"
      fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"
    />
    <circle v-for="(pt,i) in pixels" :key="i" :cx="pt.cx" :cy="pt.cy" :r="pixelR" fill="rgba(255,255,255,0.72)" />
  </g>
</template>
