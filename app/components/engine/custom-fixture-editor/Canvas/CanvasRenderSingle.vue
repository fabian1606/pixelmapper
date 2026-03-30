<script setup lang="ts">
defineProps<{
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
}>();
</script>

<template>
  <g>
    <defs>
      <radialGradient id="cf-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="white" stop-opacity="0.18" />
        <stop offset="100%" stop-color="white" stop-opacity="0"    />
      </radialGradient>
    </defs>
    <ellipse :cx="cx" :cy="cy" :rx="wPx/2" :ry="hPx/2" fill="url(#cf-glow)" />
    <ellipse
      :cx="cx" :cy="cy" :rx="wPx/2*0.9" :ry="hPx/2*0.9"
      fill="rgba(255,255,255,0.05)"
      stroke="rgba(255,255,255,0.22)" stroke-width="1.5"
    />
    <circle :cx="cx" :cy="cy" :r="Math.min(wPx,hPx)/2*0.28" fill="rgba(255,255,255,0.5)" />
    <circle :cx="cx" :cy="cy" :r="Math.min(wPx,hPx)/2*0.14" fill="rgba(255,255,255,0.9)" />
  </g>
</template>
