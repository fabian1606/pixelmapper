<script setup lang="ts">
import { computed, ref } from 'vue';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Plus, AlertTriangle } from 'lucide-vue-next';
import type { NeoPixelChipType, StripConfig } from '~/utils/engine/core/fixture';
import {
  createNeoPixelStripFixture,
  channelsPerPixel,
  logicalPixelCount,
} from '~/utils/engine/neopixel-strip-factory';
import type { Fixture } from '~/utils/engine/core/fixture';

const emit = defineEmits<{
  (e: 'add', fixtures: Fixture[]): void;
}>();

// ─── Form State ───────────────────────────────────────────────────────────────

const name = ref('NeoPixel Strip');
const chipType = ref<NeoPixelChipType>('WS2812B');
const ledCount = ref(60);
const ledsPerMeter = ref(60);
const groupSize = ref(1);

const CHIP_OPTIONS: { value: NeoPixelChipType; label: string; channels: number }[] = [
  { value: 'WS2812B',      label: 'WS2812B (RGB)',     channels: 3 },
  { value: 'WS2811',       label: 'WS2811 (RGB)',      channels: 3 },
  { value: 'APA102',       label: 'APA102 (RGB)',      channels: 3 },
  { value: 'SK6812-RGB',   label: 'SK6812 (RGB)',      channels: 3 },
  { value: 'SK6812-RGBW',  label: 'SK6812 (RGBW)',     channels: 4 },
];

const DENSITY_PRESETS = [30, 60, 100, 144];

// ─── Derived Values ───────────────────────────────────────────────────────────

const lengthMeters = computed(() =>
  ledsPerMeter.value > 0 ? ledCount.value / ledsPerMeter.value : 0
);

const pixelCount = computed(() => logicalPixelCount(ledCount.value, groupSize.value));
const chPerPixel = computed(() => channelsPerPixel(chipType.value));
const totalChannels = computed(() => pixelCount.value * chPerPixel.value);

const overflowsUniverse = computed(() => totalChannels.value > 512);

const groupSizeClamped = computed(() => Math.min(Math.max(1, groupSize.value), ledCount.value));

// ─── Submit ───────────────────────────────────────────────────────────────────

function handleAdd() {
  if (ledCount.value < 1 || ledsPerMeter.value < 1) return;

  const config: StripConfig = {
    chipType: chipType.value,
    ledCount: ledCount.value,
    ledsPerMeter: ledsPerMeter.value,
    groupSize: groupSizeClamped.value,
    lengthMeters: lengthMeters.value,
    points: [], // factory generates initial 2 vertices
  };

  // id and startAddress get reassigned by useWorkspaceOperations.handleAddOflFixtures.
  const fixture = createNeoPixelStripFixture(config, {
    id: `neopixel-${Date.now()}`,
    name: name.value || 'NeoPixel Strip',
    startAddress: 1,
  });
  emit('add', [fixture]);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- ── Row 1: Name + Chip Type ─────────────────────────────────────────── -->
    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-7 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Name</Label>
        <Input
          v-model="name"
          type="text"
          placeholder="NeoPixel Strip"
          class="h-10 bg-background"
        />
      </div>
      <div class="col-span-5 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Chip Type</Label>
        <Select v-model="chipType">
          <SelectTrigger class="h-10 bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in CHIP_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              class="text-xs"
            >
              {{ opt.label }} <span class="ml-2 opacity-50">({{ opt.channels }}ch/LED)</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- ── Row 2: LED Count + Density + Group Size ─────────────────────────── -->
    <div class="grid grid-cols-12 gap-4">
      <div class="col-span-4 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">LED Count</Label>
        <Input
          v-model.number="ledCount"
          type="number"
          min="1"
          max="2000"
          class="h-10 bg-background"
        />
      </div>
      <div class="col-span-4 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">LEDs / Meter</Label>
        <div class="flex gap-1">
          <Input
            v-model.number="ledsPerMeter"
            type="number"
            min="1"
            max="500"
            class="h-10 bg-background flex-1"
          />
        </div>
        <div class="flex gap-1 mt-1">
          <button
            v-for="preset in DENSITY_PRESETS"
            :key="preset"
            type="button"
            class="text-[10px] px-2 py-0.5 rounded border transition-colors"
            :class="ledsPerMeter === preset
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
            @click="ledsPerMeter = preset"
          >
            {{ preset }}
          </button>
        </div>
      </div>
      <div class="col-span-4 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Group Size</Label>
        <Input
          v-model.number="groupSize"
          type="number"
          min="1"
          :max="ledCount"
          class="h-10 bg-background"
        />
        <p class="text-[10px] text-muted-foreground leading-snug mt-1">
          {{ groupSize === 1
            ? 'Each LED individually addressable.'
            : `${groupSize} LEDs share one logical pixel.` }}
        </p>
      </div>
    </div>

    <!-- ── Computed Summary Strip ──────────────────────────────────────────── -->
    <div class="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div class="grid grid-cols-4 gap-4 text-center">
        <div>
          <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Length</p>
          <p class="text-base font-semibold text-foreground tabular-nums mt-1">
            {{ lengthMeters.toFixed(2) }} <span class="text-xs text-muted-foreground">m</span>
          </p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Logical Pixels</p>
          <p class="text-base font-semibold text-foreground tabular-nums mt-1">
            {{ pixelCount }}
          </p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Ch / Pixel</p>
          <p class="text-base font-semibold text-foreground tabular-nums mt-1">
            {{ chPerPixel }}
          </p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Total DMX</p>
          <p
            class="text-base font-semibold tabular-nums mt-1"
            :class="overflowsUniverse ? 'text-destructive' : 'text-foreground'"
          >
            {{ totalChannels }}
          </p>
        </div>
      </div>
    </div>

    <!-- ── Universe Overflow Warning ───────────────────────────────────────── -->
    <div
      v-if="overflowsUniverse"
      class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
    >
      <AlertTriangle class="size-4 text-destructive shrink-0 mt-0.5" />
      <div class="text-xs text-destructive leading-snug">
        <strong>Strip exceeds a single DMX universe</strong> ({{ totalChannels }} channels &gt; 512).
        Increase <em>Group Size</em> to {{ Math.ceil(totalChannels / 512) }}× to fit, or accept the overflow
        and adjust the start address manually after adding.
      </div>
    </div>

    <!-- ── Submit ──────────────────────────────────────────────────────────── -->
    <div class="flex justify-end">
      <Button
        :disabled="ledCount < 1 || ledsPerMeter < 1"
        class="px-6 h-10 font-bold tracking-tight shadow-lg shadow-primary/20"
        @click="handleAdd"
      >
        <Plus class="size-4 mr-2" />
        Add NeoPixel Strip
      </Button>
    </div>
  </div>
</template>
