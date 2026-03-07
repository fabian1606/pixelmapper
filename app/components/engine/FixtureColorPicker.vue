<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { ChannelSection, ChannelEntry } from './composables/use-channel-sections';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { type SnapshotMap } from './commands/set-channel-values-command';
import { rgbToHsv, hsvToRgb, parseHexColor, colorDistance } from '~/utils/engine/color-math';
import type { OflCapability, OflWheel, OflWheelSlot } from '~/utils/ofl/types';

const props = defineProps<{
  channelSections: ChannelSection[];
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

const { captureSnapshots, commitSnapshots } = useChannelValueHistory();

// ─── Extract Relevant Channels ─────────────────────────────────────────────

interface ColorFixtureData {
  fixture: Fixture;
  redChs: any[];
  greenChs: any[];
  blueChs: any[];
  wheelCh?: any;
}

const colorFixtures = computed(() => {
  const map = new Map<string, ColorFixtureData>();

  for (const section of props.channelSections) {
    for (const entry of section.entries) {
      if (['RED', 'GREEN', 'BLUE', 'COLOR_WHEEL'].includes(entry.channelType)) {
        for (const fixture of entry.fixtures) {
          if (!map.has(String(fixture.id))) {
            map.set(String(fixture.id), { fixture, redChs: [], greenChs: [], blueChs: [] });
          }
          const fd = map.get(String(fixture.id))!;
          
          // Collect ALL channels of this type (not just the last one)
          for (const ch of fixture.channels) {
            if (ch.type !== entry.channelType) continue;
            if ((ch.oflChannelName ?? ch.type) !== (entry.oflChannelName ?? entry.channelType)) continue;
            if (entry.channelType === 'RED'   && !fd.redChs.includes(ch))   fd.redChs.push(ch);
            if (entry.channelType === 'GREEN' && !fd.greenChs.includes(ch)) fd.greenChs.push(ch);
            if (entry.channelType === 'BLUE'  && !fd.blueChs.includes(ch))  fd.blueChs.push(ch);
            if (entry.channelType === 'COLOR_WHEEL') fd.wheelCh = ch;
          }
        }
      }
    }
  }

  // Filter out fixtures that don't have either (R, G, and B) OR a color wheel
  return Array.from(map.values()).filter(fd => 
    (fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0) || fd.wheelCh
  );
});

const hasRgb = computed(() => colorFixtures.value.some(fd => fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0));
const hasWheel = computed(() => colorFixtures.value.some(fd => fd.wheelCh));

// ─── Extract Color Wheel Colors ──────────────────────────────────────────

interface WheelColorOpt {
  hex: string;
  r: number;
  g: number;
  b: number;
  value: number; // Midpoint of DMX range for this slot
  name: string;
}

const wheelColors = computed<WheelColorOpt[]>(() => {
  if (!hasWheel.value) return [];
  const opts: WheelColorOpt[] = [];
  const seenHex = new Set<string>();

  for (const fd of colorFixtures.value) {
    if (fd.wheelCh?.oflCapabilities && fd.wheelCh?.oflWheels) {
      const wheels: Record<string, OflWheel> = fd.wheelCh.oflWheels;
      
      for (const cap of fd.wheelCh.oflCapabilities as OflCapability[]) {
        if (!cap.wheel) continue;
        
        const wheel = wheels[cap.wheel];
        if (!wheel) continue;
        
        const slotIdx = (cap.slotNumber ?? 1) - 1;
        const slot = wheel.slots[slotIdx];
        
        if (slot?.colors && slot.colors[0] && cap.dmxRange) {
          const hex = slot.colors[0];
          if (!seenHex.has(hex)) {
            seenHex.add(hex);
            const rgb = parseHexColor(hex);
            if (rgb) {
              const value = Math.round((cap.dmxRange[0] + cap.dmxRange[1]) / 2);
              opts.push({
                hex,
                r: rgb.r,
                g: rgb.g,
                b: rgb.b,
                value,
                name: cap.comment ?? slot.name ?? hex
              });
            }
          }
        }
      }
    }
  }
  return opts;
});

// ─── Representative State ────────────────────────────────────────────────

const avgRgb = computed(() => {
  if (!hasRgb.value) return { r: 0, g: 0, b: 0 };
  
  let validCount = 0;
  let totalR = 0, totalG = 0, totalB = 0;

  for (const fd of colorFixtures.value) {
    if (fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0) {
      totalR += fd.redChs[0].chaserConfig.stepValues[props.activeStep] ?? 0;
      totalG += fd.greenChs[0].chaserConfig.stepValues[props.activeStep] ?? 0;
      totalB += fd.blueChs[0].chaserConfig.stepValues[props.activeStep] ?? 0;
      validCount++;
    }
  }

  if (validCount === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(totalR / validCount),
    g: Math.round(totalG / validCount),
    b: Math.round(totalB / validCount)
  };
});

// Calculate current HSV for positioning the picker. V is fixed to 100 for the UI handle position matching.
const currentHsv = computed(() => {
  const { r, g, b } = avgRgb.value;
  return rgbToHsv(r, g, b);
});

// ─── Wheel Drag Logic (CSS/Math based) ───────────────────────────────────

const wheelContainer = ref<HTMLElement | null>(null);
const isDraggingWheel = ref(false);
let currentDragSnapshots: SnapshotMap | null = null;

function padStepValues(ch: any, val: number) {
  while (ch.chaserConfig.stepValues.length <= props.activeStep) {
    ch.chaserConfig.stepValues.push(ch.chaserConfig.stepValues[ch.chaserConfig.stepValues.length - 1] ?? 0);
  }
  ch.chaserConfig.stepValues[props.activeStep] = val;

  if (props.activeStep > 0 && ch.chaserConfig.stepsCount <= props.activeStep) {
    ch.chaserConfig.stepsCount = props.activeStep + 1;
  }
}

function updateColorFromEvent(e: MouseEvent | TouchEvent) {
  if (!wheelContainer.value) return;

  const rect = wheelContainer.value.getBoundingClientRect();
  const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
  const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : (e as MouseEvent).clientY;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const x = clientX - rect.left - centerX;
  const y = clientY - rect.top - centerY;

  const radius = Math.min(centerX, centerY);
  const distance = Math.min(Math.sqrt(x * x + y * y), radius);
  
  // Angle in radians, -PI to PI
  let angle = Math.atan2(y, x);
  // Convert map so 0 is right, rotating clockwise. HSV: 0=red, 120=green, 240=blue.
  // We want standard color wheel translation
  let hue = (angle * 180 / Math.PI) + 90; 
  if (hue < 0) hue += 360;
  
  // HSV Saturation maps directly to radius.
  // We want the edges (radius) to be 100% saturation.
  const saturation = Math.min((distance / radius) * 100, 100);
  
  // We force V to 100 to pick pure/bright colors instead of dark ones
  // Alternatively, could keep the current V of the fixtures: const v = currentHsv.value.v;
  // but a 2D wheel typically picks full brightness.
  const value = 100; 

  const { r, g, b } = hsvToRgb(hue, saturation, value);

  // Allow parent to sync via before-change
  const allFixtures = colorFixtures.value.map(fd => fd.fixture);
  emit('before-change', allFixtures);

  // Update ALL RGB channels
  for (const fd of colorFixtures.value) {
    if (fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0) {
      for (const ch of fd.redChs)   padStepValues(ch, r);
      for (const ch of fd.greenChs) padStepValues(ch, g);
      for (const ch of fd.blueChs)  padStepValues(ch, b);
    }
    
    // Sync Wheel to nearest color
    if (fd.wheelCh && wheelColors.value.length > 0) {
      let bestDist = Infinity;
      let bestVal = 0;
      for (const wCol of wheelColors.value) {
        const dist = colorDistance(r, g, b, wCol.r, wCol.g, wCol.b);
        if (dist < bestDist) {
          bestDist = dist;
          bestVal = wCol.value;
        }
      }
      padStepValues(fd.wheelCh, bestVal);
    }
  }
}

function startWheelDrag(e: MouseEvent | TouchEvent) {
  if ('button' in e && e.button !== 0) return;
  e.preventDefault();
  isDraggingWheel.value = true;
  
  const allFixtures = colorFixtures.value.map(fd => fd.fixture);
  currentDragSnapshots = captureSnapshots(allFixtures);
  
  updateColorFromEvent(e);

  window.addEventListener('mousemove', onWheelDrag);
  window.addEventListener('mouseup', stopWheelDrag);
  window.addEventListener('touchmove', onWheelDrag, { passive: false });
  window.addEventListener('touchend', stopWheelDrag);
}

function onWheelDrag(e: MouseEvent | TouchEvent) {
  if (!isDraggingWheel.value) return;
  e.preventDefault(); // prevent scroll on touch
  updateColorFromEvent(e);
}

function stopWheelDrag(e: MouseEvent | TouchEvent) {
  if (!isDraggingWheel.value) return;
  isDraggingWheel.value = false;
  
  window.removeEventListener('mousemove', onWheelDrag);
  window.removeEventListener('mouseup', stopWheelDrag);
  window.removeEventListener('touchmove', onWheelDrag);
  window.removeEventListener('touchend', stopWheelDrag);

  if (currentDragSnapshots) {
    commitSnapshots(currentDragSnapshots, 'Color Wheel Change');
    currentDragSnapshots = null;
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onWheelDrag);
  window.removeEventListener('mouseup', stopWheelDrag);
  window.removeEventListener('touchmove', onWheelDrag);
  window.removeEventListener('touchend', stopWheelDrag);
});

// ─── Box Click Logic ─────────────────────────────────────────────────────

function selectColorBox(c: WheelColorOpt) {
  const allFixtures = colorFixtures.value.map(fd => fd.fixture);
  const snapshots = captureSnapshots(allFixtures);
  
  emit('before-change', allFixtures);

  for (const fd of colorFixtures.value) {
    if (fd.wheelCh) {
      padStepValues(fd.wheelCh, c.value);
    }
    if (fd.redChs.length > 0 && fd.greenChs.length > 0 && fd.blueChs.length > 0) {
      for (const ch of fd.redChs)   padStepValues(ch, c.r);
      for (const ch of fd.greenChs) padStepValues(ch, c.g);
      for (const ch of fd.blueChs)  padStepValues(ch, c.b);
    }
  }

  commitSnapshots(snapshots, `Set Color to ${c.name}`);
}

// ─── Handle Position Calculation ──────────────────────────────────────────

const handleStyle = computed(() => {
  // We compute handle position from avgRgb -> currentHsv
  // Saturation is distance from center (0 to 100)
  // Hue is angle
  let { h, s, v } = currentHsv.value;
  
  // Angle for UI wheel: -90 degrees from standard match (CSS conic-gradient starts at top)
  let angleDeg = h - 90; 
  
  // In HSV, S directly maps to radius distance from center.
  let radiusPercent = s; 

  const angleRad = angleDeg * Math.PI / 180;
  
  // Max radius is 50%
  const distance = (radiusPercent / 100) * 50; 
  
  const left = 50 + Math.cos(angleRad) * distance;
  const top = 50 + Math.sin(angleRad) * distance;
  
  return {
    left: `${left}%`,
    top: `${top}%`,
    backgroundColor: `rgb(${avgRgb.value.r}, ${avgRgb.value.g}, ${avgRgb.value.b})`
  };
});

</script>

<template>
  <div v-if="colorFixtures.length > 0" class="mb-6 space-y-4">
    <!-- RGB HSL Wheel -->
    <div v-if="hasRgb" class="flex justify-center my-4">
      <div 
        ref="wheelContainer"
        class="relative w-48 h-48 rounded-full shadow-inner cursor-crosshair touch-none select-none"
        style="background: conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red);"
        @mousedown="startWheelDrag"
        @touchstart="startWheelDrag"
      >
        <!-- Overlay pure white center gradient -->
        <div class="absolute inset-0 rounded-full pointer-events-none mix-blend-screen" style="background: radial-gradient(circle at center, rgb(255,255,255) 0%, rgba(255,255,255,0) 100%);"></div>
        <div class="absolute inset-0 rounded-full pointer-events-none mix-blend-multiply" style="background: radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 100%); shadow-inner"></div>
        
        <!-- Handle -->
        <div 
          class="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-white shadow-md pointer-events-none"
          :style="handleStyle"
        ></div>
      </div>
    </div>

    <!-- Color Wheel Boxes -->
    <div v-if="hasWheel" class="grid grid-cols-6 gap-2 px-1">
      <button
        v-for="c in wheelColors"
        :key="c.hex"
        class="w-8 h-8 rounded-md shadow-sm border border-border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
        :style="{ backgroundColor: c.hex }"
        :title="c.name"
        @click="selectColorBox(c)"
      ></button>
    </div>
  </div>
</template>
