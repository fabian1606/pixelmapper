<script setup lang="ts">
/**
 * Add form of the `neopixel-strip` kind (`library.addForm` contract:
 * `modelValue` config in, `update:modelValue` + `add(config, count)` out).
 * Shows the derived length, pixel and channel counts while editing.
 */
import { computed } from 'vue';
import type { Json } from '@pixelmapper/extension-api';
import { CHIP_TYPES, SHAPE_TYPES, channelsPerPixel, defaultConfig, lengthMeters, logicalPixelCount, type StripConfig } from '../config';

const props = defineProps<{ modelValue: Json | null }>();

const emit = defineEmits<{
  'update:modelValue': [config: Json];
  add: [config: Json, count: number];
}>();

/** Current config with defaults. */
const config = computed<StripConfig>(() => ({ ...defaultConfig(), ...((props.modelValue ?? {}) as Partial<StripConfig>) }));

/** Updates one field. */
function set<K extends keyof StripConfig>(key: K, value: StripConfig[K]) {
  const next = { ...config.value, [key]: value };
  // A new shape gets fresh default points from the kind.
  if (key === 'shapeType') next.points = [];
  emit('update:modelValue', next as unknown as Json);
}

/** Integer from an input event, clamped. */
function int(e: Event, min: number, max: number): number {
  const v = Math.round(Number((e.target as HTMLInputElement).value));
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

const DENSITY_PRESETS = [30, 60, 100, 144];
const pixels = computed(() => logicalPixelCount(config.value.ledCount, config.value.groupSize));
const channels = computed(() => pixels.value * channelsPerPixel(config.value.chipType));

const field = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground';
const label = 'text-[10px] uppercase tracking-widest font-bold text-muted-foreground';
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="grid grid-cols-2 gap-4">
      <label class="flex flex-col gap-2">
        <span :class="label">Chip type</span>
        <select :class="field" :value="config.chipType" @change="set('chipType', ($event.target as HTMLSelectElement).value as StripConfig['chipType'])">
          <option v-for="c in CHIP_TYPES" :key="c.value" :value="c.value">{{ c.label }} ({{ c.channels }} ch/pixel)</option>
        </select>
      </label>
      <label class="flex flex-col gap-2">
        <span :class="label">Shape</span>
        <select :class="field" :value="config.shapeType" @change="set('shapeType', ($event.target as HTMLSelectElement).value as StripConfig['shapeType'])">
          <option v-for="s in SHAPE_TYPES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>
    </div>

    <div class="grid grid-cols-3 gap-4">
      <label class="flex flex-col gap-2">
        <span :class="label">LED count</span>
        <input :class="field" type="number" min="1" max="2000" :value="config.ledCount" @change="set('ledCount', int($event, 1, 2000))">
      </label>
      <div class="flex flex-col gap-2">
        <span :class="label">LEDs / meter</span>
        <input :class="field" type="number" min="1" max="500" :value="config.ledsPerMeter" @change="set('ledsPerMeter', int($event, 1, 500))">
        <div class="flex gap-1">
          <button
            v-for="d in DENSITY_PRESETS"
            :key="d"
            type="button"
            class="text-[10px] px-2 py-0.5 rounded border transition-colors"
            :class="config.ledsPerMeter === d ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
            @click="set('ledsPerMeter', d)"
          >
            {{ d }}
          </button>
        </div>
      </div>
      <label class="flex flex-col gap-2">
        <span :class="label">Group size</span>
        <input :class="field" type="number" min="1" :max="config.ledCount" :value="config.groupSize" @change="set('groupSize', int($event, 1, config.ledCount))">
        <span class="text-[10px] text-muted-foreground">{{ config.groupSize === 1 ? 'Each LED individually addressable.' : `${config.groupSize} LEDs share one pixel.` }}</span>
      </label>
    </div>

    <div v-if="config.shapeType === 'circle'" class="flex items-center gap-2">
      <span :class="label">Direction</span>
      <button
        v-for="cw in [true, false]"
        :key="String(cw)"
        type="button"
        class="h-8 px-3 rounded border text-xs font-medium transition-colors"
        :class="config.clockwise === cw ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
        @click="set('clockwise', cw)"
      >
        {{ cw ? 'CW' : 'CCW' }}
      </button>
    </div>

    <div class="flex items-center gap-4 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span>{{ lengthMeters(config).toFixed(2) }} m</span>
      <span>{{ pixels }} pixels</span>
      <span>{{ channels }} channels</span>
      <button
        type="button"
        class="ml-auto h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        @click="emit('add', config as unknown as Json, 1)"
      >
        Add strip
      </button>
    </div>
  </div>
</template>
