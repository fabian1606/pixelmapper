<script setup lang="ts">
/**
 * Static miniature of one live widget for the version-history hover preview.
 * Mirrors the live widgets' chrome (pm.button, vertical pm.fader track,
 * xy faders, color header + RGB bars, tap-tempo dot, fixture preview,
 * controller twin, dashed extension box) without values or interaction.
 */
import { computed } from 'vue';
import type { PreviewWidgetRect } from '~/utils/sync/version-preview/live-page-preview';

const props = defineProps<{ widget: PreviewWidgetRect; fontPx: number }>();

/** Labels are hidden when the widget is too small to fit a line. */
const showLabel = computed(() => props.widget.height >= props.fontPx + 2 && props.widget.width >= props.fontPx * 1.5);
const font = computed(() => ({ fontSize: `${props.fontPx}px`, lineHeight: 1.1 }));
const button = computed(() => props.widget.color ?? '#334155');
</script>

<template>
  <!-- Button: filled, colored border, centered white label -->
  <div
    v-if="widget.kind === 'button'"
    class="flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] border font-medium text-white"
    :style="{ backgroundColor: button, borderColor: `${button}88`, ...font }"
  >
    <span v-if="showLabel" class="truncate px-0.5">{{ widget.label }}</span>
  </div>

  <!-- Slider: vertical track with fill and label at the bottom -->
  <div v-else-if="widget.kind === 'slider'" class="relative flex h-full w-full flex-col-reverse overflow-hidden rounded-[2px] border border-white/10">
    <div class="h-[35%] w-full opacity-70" :style="{ backgroundColor: widget.color ?? '#6366f1' }" />
    <span v-if="showLabel" class="absolute inset-x-0 bottom-0.5 truncate text-center text-white/60" :style="font">{{ widget.label }}</span>
  </div>

  <!-- XY: label + two horizontal fader tracks (core pm.xyInput) -->
  <div v-else-if="widget.kind === 'xy'" class="flex h-full w-full flex-col justify-center gap-[2px] overflow-hidden rounded-[2px] border border-white/10 p-[2px]">
    <span v-if="showLabel" class="truncate text-zinc-400" :style="font">{{ widget.label }}</span>
    <div class="h-[18%] min-h-[2px] rounded-[1px] border border-white/10 bg-white/5" />
    <div class="h-[18%] min-h-[2px] rounded-[1px] border border-white/10 bg-white/5" />
  </div>

  <!-- Color: dark card, uppercase header, RGB bars -->
  <div v-else-if="widget.kind === 'color'" class="flex h-full w-full flex-col gap-[2px] overflow-hidden rounded-[2px] border border-white/10 bg-[#1a1a1a] p-[2px]">
    <span v-if="showLabel" class="truncate font-semibold uppercase tracking-wider text-zinc-400" :style="font">{{ widget.label }}</span>
    <div class="flex flex-1 flex-col justify-center gap-[2px]">
      <div class="h-[2px] rounded bg-red-500/70" />
      <div class="h-[2px] rounded bg-green-500/70" />
      <div class="h-[2px] rounded bg-blue-500/70" />
    </div>
  </div>

  <!-- Label: text with bottom rule -->
  <div
    v-else-if="widget.kind === 'label'"
    class="flex h-full w-full items-center overflow-hidden border-b border-white/10 px-0.5 font-medium text-white/60"
    :style="{ ...font, color: widget.color ?? undefined }"
  >
    <span class="truncate">{{ widget.label }}</span>
  </div>

  <!-- Beat: tap tempo with dot and caption -->
  <div
    v-else-if="widget.kind === 'beat'"
    class="flex h-full w-full flex-col items-center justify-center gap-[1px] overflow-hidden rounded-[2px]"
    :style="{ backgroundColor: widget.color ?? '#1e293b' }"
  >
    <span class="size-[3px] rounded-full bg-white/60" />
    <span v-if="showLabel" class="font-mono text-white/50" :style="font">{{ widget.label }}</span>
  </div>

  <!-- Fixture preview: dark viewport with a few fixture dots -->
  <div v-else-if="widget.kind === 'fixture-preview'" class="flex h-full w-full items-center justify-center gap-[3px] overflow-hidden rounded-[2px] bg-[#101010]">
    <span v-for="i in 4" :key="i" class="size-[3px] rounded-full bg-zinc-500" />
  </div>

  <!-- Controller twin: device body with a pad grid -->
  <div v-else-if="widget.kind === 'controller-twin'" class="flex h-full w-full flex-col gap-[2px] overflow-hidden rounded-[2px] border border-white/10 bg-neutral-900 p-[2px]">
    <span v-if="showLabel" class="truncate text-zinc-500" :style="font">{{ widget.label }}</span>
    <div class="grid flex-1 grid-cols-4 gap-[1px]">
      <span v-for="i in 8" :key="i" class="rounded-[1px] bg-white/10" />
    </div>
  </div>

  <!-- Extension / unknown: dashed box with label -->
  <div v-else class="flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] border border-dashed border-white/20 text-center text-zinc-400" :style="font">
    <span v-if="showLabel" class="truncate px-0.5">{{ widget.label }}</span>
  </div>
</template>
