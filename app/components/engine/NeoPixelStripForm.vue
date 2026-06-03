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
import { Plus } from 'lucide-vue-next';
import type { NeoPixelChipType, StripConfig, StripShapeType } from '~/utils/engine/core/fixture';
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
const shapeType = ref<StripShapeType>('bezier');
const clockwise = ref(true);
const ledCount = ref(60);
const ledsPerMeter = ref(60);
const groupSize = ref(1);

const SHAPE_OPTIONS: { value: StripShapeType; label: string }[] = [
  { value: 'bezier', label: 'Bezier Curve' },
  { value: 'line',   label: 'Straight Line' },
  { value: 'circle', label: 'Circle' },
];

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
// Circle diameter in meters: circumference = ledCount/ledsPerMeter, diameter = circumference/π
const circleDiameterM = computed(() => lengthMeters.value / Math.PI);


const groupSizeClamped = computed(() => Math.min(Math.max(1, groupSize.value), ledCount.value));

// Logical pixels drive ESP32 RAM usage (~3 render targets each). High counts —
// especially with Bezier/SpeedCurve effects — can exhaust the ESP32-S3 heap.
const WARN_PIXEL_THRESHOLD = 600;
const HARD_PIXEL_THRESHOLD = 1000;
const pixelSeverity = computed<'none' | 'warn' | 'hard'>(() => {
  if (pixelCount.value > HARD_PIXEL_THRESHOLD) return 'hard';
  if (pixelCount.value > WARN_PIXEL_THRESHOLD) return 'warn';
  return 'none';
});

// ─── Submit ───────────────────────────────────────────────────────────────────

function handleAdd() {
  if (ledCount.value < 1 || ledsPerMeter.value < 1) return;

  const config: StripConfig = {
    shapeType: shapeType.value,
    chipType: chipType.value,
    ledCount: ledCount.value,
    ledsPerMeter: ledsPerMeter.value,
    groupSize: groupSizeClamped.value,
    lengthMeters: lengthMeters.value,
    points: [], // factory generates initial vertices per shape
    clockwise: clockwise.value,
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

    <!-- ── Row 3: Shape + Direction ─────────────────────────────────────────── -->
    <div class="grid grid-cols-12 gap-4">
      <div :class="shapeType === 'circle' ? 'col-span-8' : 'col-span-12'" class="space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Shape</Label>
        <Select v-model="shapeType">
          <SelectTrigger class="h-10 bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in SHAPE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              class="text-xs"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div v-if="shapeType === 'circle'" class="col-span-4 space-y-2.5">
        <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Direction</Label>
        <div class="flex gap-1 h-10">
          <button
            type="button"
            class="flex-1 rounded border text-xs font-medium transition-colors"
            :class="clockwise
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
            @click="clockwise = true"
          >CW</button>
          <button
            type="button"
            class="flex-1 rounded border text-xs font-medium transition-colors"
            :class="!clockwise
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'"
            @click="clockwise = false"
          >CCW</button>
        </div>
      </div>
    </div>

    <!-- ── Computed Summary Strip ──────────────────────────────────────────── -->
    <div class="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div class="grid grid-cols-4 gap-4 text-center">
        <div>
          <template v-if="shapeType === 'circle'">
            <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Diameter</p>
            <p class="text-base font-semibold text-foreground tabular-nums mt-1">
              {{ (circleDiameterM * 100).toFixed(1) }} <span class="text-xs text-muted-foreground">cm</span>
            </p>
          </template>
          <template v-else>
            <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Length</p>
            <p class="text-base font-semibold text-foreground tabular-nums mt-1">
              {{ lengthMeters.toFixed(2) }} <span class="text-xs text-muted-foreground">m</span>
            </p>
          </template>
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
          <p class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Total Channels</p>
          <p class="text-base font-semibold tabular-nums mt-1 text-foreground">
            {{ totalChannels }}
          </p>
        </div>
      </div>
    </div>

    <!-- ── RAM / pixel-count warning ───────────────────────────────────────── -->
    <div
      v-if="pixelSeverity !== 'none'"
      class="rounded-lg border px-4 py-3 text-xs leading-relaxed"
      :class="pixelSeverity === 'hard'
        ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
        : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'"
    >
      <span class="font-semibold">{{ pixelCount }} logische Pixel</span>
      <template v-if="pixelSeverity === 'hard'">
        — sehr hoch. Der ESP32 kann hier (v.a. mit Bezier/SpeedCurve-Effekten)
        instabil werden oder abstürzen. Reduziere die LED-Anzahl oder erhöhe die
        Gruppengröße. Über LAN/Ethernet ist mehr möglich als über WLAN.
      </template>
      <template v-else>
        — am Limit. Über WLAN können Aussetzer auftreten; erhöhe die Gruppengröße,
        falls der ESP abstürzt.
      </template>
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
