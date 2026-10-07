<script setup lang="ts">
/**
 * Color control of the property sidebar (core, `rgb` signature).
 *
 * Maps the selected fixtures' color channels to one linear RGB value and
 * renders it with the replaceable `pm.colorInput` (core default: faders + hex;
 * the color-picker extension: HSV wheel). Writes go back to all RED/GREEN/BLUE
 * channels and snap color wheels to the nearest slot (ADR §6.4 write path).
 * Color-wheel slots are offered as swatches. A drag is one undo step.
 */
import { computed } from 'vue';
import type { ColorSwatch, RgbColor } from '@pixelmapper/extension-api';
import type { ChannelSection } from './composables/use-channel-sections';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import type { OflCapability, OflWheel } from '~/utils/ofl/types';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { useEngineStore } from '~/stores/engine-store';
import type { SnapshotMap } from './commands/set-channel-values-command';
import { parseHexColor, colorDistance } from '~/utils/engine/color-math';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  channelSections: ChannelSection[];
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

const { captureSnapshots, commitSnapshots } = useChannelValueHistory();
const engineStore = useEngineStore();

// ─── Color channels per fixture ──────────────────────────────────────────────

interface ColorFixtureData {
  fixture: Fixture;
  redChs: Channel[];
  greenChs: Channel[];
  blueChs: Channel[];
  wheelCh?: Channel;
}

const COLOR_TYPES = ['RED', 'GREEN', 'BLUE', 'COLOR_WHEEL'];

/** Fixtures with full RGB or a color wheel among the shown sections. */
const colorFixtures = computed(() => {
  const map = new Map<string, ColorFixtureData>();
  for (const section of props.channelSections) {
    for (const entry of section.entries) {
      if (!COLOR_TYPES.includes(entry.channelType)) continue;
      for (const fixture of entry.fixtures) {
        const key = String(fixture.id);
        if (!map.has(key)) map.set(key, { fixture, redChs: [], greenChs: [], blueChs: [] });
        const fd = map.get(key)!;
        // Collect ALL channels of this type and name (multi-cell fixtures).
        for (const ch of fixture.channels) {
          if (ch.type !== entry.channelType) continue;
          if ((ch.oflChannelName ?? ch.type) !== (entry.oflChannelName ?? entry.channelType)) continue;
          if (ch.type === 'RED' && !fd.redChs.includes(ch)) fd.redChs.push(ch);
          if (ch.type === 'GREEN' && !fd.greenChs.includes(ch)) fd.greenChs.push(ch);
          if (ch.type === 'BLUE' && !fd.blueChs.includes(ch)) fd.blueChs.push(ch);
          if (ch.type === 'COLOR_WHEEL') fd.wheelCh = ch;
        }
      }
    }
  }
  return [...map.values()].filter(fd => isRgb(fd) || fd.wheelCh);
});

/** True when the fixture has all three RGB channels. */
function isRgb(fd: ColorFixtureData): boolean {
  return fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0;
}

// ─── Color-wheel slots ───────────────────────────────────────────────────────

interface WheelSlot {
  rgb: { r: number; g: number; b: number };
  /** DMX midpoint of the slot range. */
  value: number;
  name: string;
}

/** Distinct wheel slot colors across the selection. */
const wheelSlots = computed<WheelSlot[]>(() => {
  const out: WheelSlot[] = [];
  const seen = new Set<string>();
  for (const fd of colorFixtures.value) {
    const ch = fd.wheelCh;
    if (!ch?.oflCapabilities || !ch.oflWheels) continue;
    const wheels: Record<string, OflWheel> = ch.oflWheels;
    for (const cap of ch.oflCapabilities as OflCapability[]) {
      const c = cap as Record<string, unknown>;
      const wheel = wheels[c.wheel as string];
      if (!wheel || !cap.dmxRange) continue;
      const slot = wheel.slots[((c.slotNumber as number | undefined) ?? 1) - 1];
      const hex = slot?.colors?.[0];
      if (!hex || seen.has(hex)) continue;
      const rgb = parseHexColor(hex);
      if (!rgb) continue;
      seen.add(hex);
      out.push({ rgb, value: Math.round((cap.dmxRange[0] + cap.dmxRange[1]) / 2), name: cap.comment ?? slot?.name ?? hex });
    }
  }
  return out;
});

/** Wheel slots as swatches for the input. */
const swatches = computed<ColorSwatch[]>(() => wheelSlots.value.map(s => ({
  color: { r: s.rgb.r / 255, g: s.rgb.g / 255, b: s.rgb.b / 255 },
  label: s.name,
})));

// ─── Current value ───────────────────────────────────────────────────────────

/** Average RGB of the RGB fixtures at the active step, normalized 0–1. */
const value = computed<RgbColor>(() => {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const fd of colorFixtures.value) {
    if (!isRgb(fd)) continue;
    r += fd.redChs[0]!.chaserConfig.stepValues[props.activeStep] ?? 0;
    g += fd.greenChs[0]!.chaserConfig.stepValues[props.activeStep] ?? 0;
    b += fd.blueChs[0]!.chaserConfig.stepValues[props.activeStep] ?? 0;
    n++;
  }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
});

// ─── Writing ─────────────────────────────────────────────────────────────────

/** Writes `val` at the active step, padding the step list if needed. */
function writeStep(ch: Channel, val: number) {
  const steps = ch.chaserConfig.stepValues;
  while (steps.length <= props.activeStep) steps.push(steps[steps.length - 1] ?? 0);
  steps[props.activeStep] = val;
  if (props.activeStep > 0 && ch.chaserConfig.stepsCount <= props.activeStep) {
    ch.chaserConfig.stepsCount = props.activeStep + 1;
  }
}

/** Snapshots of the running scrub (one undo step per drag). */
let scrubSnapshots: SnapshotMap | null = null;

function onScrubStart() {
  scrubSnapshots = captureSnapshots(colorFixtures.value.map(fd => fd.fixture));
}

function onScrubEnd() {
  if (!scrubSnapshots) return;
  commitSnapshots(scrubSnapshots, 'Color Change');
  scrubSnapshots = null;
}

/** Applies a color to all RGB channels and the nearest color-wheel slot. */
function apply(color: RgbColor) {
  const single = !scrubSnapshots;
  if (single) onScrubStart();

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  emit('before-change', colorFixtures.value.map(fd => fd.fixture));

  for (const fd of colorFixtures.value) {
    if (isRgb(fd)) {
      for (const ch of fd.redChs) writeStep(ch, r);
      for (const ch of fd.greenChs) writeStep(ch, g);
      for (const ch of fd.blueChs) writeStep(ch, b);
    }
    if (fd.wheelCh && wheelSlots.value.length > 0) {
      let best = wheelSlots.value[0]!;
      let bestDist = Infinity;
      for (const s of wheelSlots.value) {
        const d = colorDistance(r, g, b, s.rgb.r, s.rgb.g, s.rgb.b);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      writeStep(fd.wheelCh, best.value);
    }
  }
  // Live-dispatch so DMX connectors follow during a drag.
  engineStore.markChannelsDirty();

  if (single) onScrubEnd();
}
</script>

<template>
  <div v-if="colorFixtures.length > 0" class="mb-6">
    <Replaceable
      name="pm.colorInput"
      :model-value="value"
      :swatches="swatches"
      @update:model-value="apply"
      @scrub-start="onScrubStart"
      @scrub-end="onScrubEnd"
    />
  </div>
</template>
