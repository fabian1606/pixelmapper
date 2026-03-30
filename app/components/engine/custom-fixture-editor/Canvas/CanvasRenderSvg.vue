<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  customSvgData: string;
  headSelections: string[];
}>();

const processedSvgData = computed(() => {
  if (!props.customSvgData) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(props.customSvgData, 'image/svg+xml');
    for (const id of props.headSelections) {
      const el = doc.getElementById(id);
      if (el) { el.setAttribute('stroke', '#3b82f6'); el.setAttribute('stroke-width', '2'); }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch { return props.customSvgData; }
});
</script>

<template>
  <g v-if="processedSvgData">
    <foreignObject :x="cx - wPx/2" :y="cy - hPx/2" :width="wPx" :height="hPx">
      <div xmlns="http://www.w3.org/1999/xhtml" class="w-full h-full custom-svg-container" v-html="processedSvgData" />
    </foreignObject>
  </g>
</template>

<style>
.custom-svg-container svg { width: 100%; height: 100%; pointer-events: all; }
.custom-svg-container *:not(svg):hover { outline: 1px dashed rgba(255,255,255,0.4); cursor: pointer; }
</style>
