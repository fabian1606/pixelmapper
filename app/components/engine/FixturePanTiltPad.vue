<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { ChannelSection } from './composables/use-channel-sections';
import type { Fixture } from '~/utils/engine/core/fixture';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { type SnapshotMap } from './commands/set-channel-values-command';

const props = defineProps<{
  channelSections: ChannelSection[];
  activeStep: number;
}>();

const emit = defineEmits<{
  (e: 'before-change', fixtures: Fixture[]): void;
}>();

const { captureSnapshots, commitSnapshots } = useChannelValueHistory();

// ─── Extract Relevant Channels ─────────────────────────────────────────────

interface PanTiltFixtureData {
  fixture: Fixture;
  panCh?: any;
  tiltCh?: any;
}

const panTiltFixtures = computed(() => {
  const map = new Map<string, PanTiltFixtureData>();

  for (const section of props.channelSections) {
    for (const entry of section.entries) {
      if (['PAN', 'TILT'].includes(entry.channelType)) {
        for (const fixture of entry.fixtures) {
          if (!map.has(String(fixture.id))) {
            map.set(String(fixture.id), { fixture });
          }
          const fd = map.get(String(fixture.id))!;
          
          const ch = fixture.channels.find(c => 
            c.type === entry.channelType && 
            (c.oflChannelName ?? c.type) === (entry.oflChannelName ?? entry.channelType)
          );
          
          if (ch) {
            if (entry.channelType === 'PAN') fd.panCh = ch;
            if (entry.channelType === 'TILT') fd.tiltCh = ch;
          }
        }
      }
    }
  }

  // Filter out fixtures that don't have BOTH PAN and TILT
  return Array.from(map.values()).filter(fd => fd.panCh && fd.tiltCh);
});

const hasPanTilt = computed(() => panTiltFixtures.value.length > 0);

// ─── Representative State ────────────────────────────────────────────────

const avgPanTilt = computed(() => {
  if (!hasPanTilt.value) return { pan: 0, tilt: 0 };
  
  let validCount = 0;
  let totalP = 0, totalT = 0;

  for (const fd of panTiltFixtures.value) {
    totalP += fd.panCh?.stepValues[props.activeStep] ?? 0;
    totalT += fd.tiltCh?.stepValues[props.activeStep] ?? 0;
    validCount++;
  }

  if (validCount === 0) return { pan: 0, tilt: 0 };
  return {
    pan: Math.round(totalP / validCount),
    tilt: Math.round(totalT / validCount)
  };
});

// ─── XY Pad Drag Logic ───────────────────────────────────────────────────

const padContainer = ref<HTMLElement | null>(null);
const isDraggingPad = ref(false);
let currentDragSnapshots: SnapshotMap | null = null;

function padStepValues(ch: any, val: number) {
  while (ch.stepValues.length <= props.activeStep) {
    ch.stepValues.push(ch.stepValues[ch.stepValues.length - 1] ?? 0);
  }
  ch.stepValues[props.activeStep] = Math.max(0, Math.min(255, Math.round(val)));

  if (!ch.chaserConfig && props.activeStep > 0) {
    ch.chaserConfig = {
      stepsCount: props.activeStep + 1,
      activeEditStep: props.activeStep,
      isPlaying: true,
      stepDurationMs: 1000,
      fadeDurationMs: 0
    };
  } else if (ch.chaserConfig && ch.chaserConfig.stepsCount <= props.activeStep) {
    ch.chaserConfig.stepsCount = props.activeStep + 1;
  }
}

function updatePanTiltFromEvent(e: MouseEvent | TouchEvent) {
  if (!padContainer.value) return;

  const rect = padContainer.value.getBoundingClientRect();
  const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
  const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : (e as MouseEvent).clientY;

  // Clamp strictly to rect bounds
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const y = Math.max(0, Math.min(clientY - rect.top, rect.height));

  const pctX = x / rect.width;
  const pctY = y / rect.height;

  // X correlates to PAN (0=Left, 255=Right)
  const panVal = pctX * 255;
  // Y correlates to TILT. Visually Y=0 is Top, Y=1 is Bottom.
  // Standard pan/tilt pads typically have 255 at Top. So 1-pctY. Or 255 at bottom.
  // We'll map Top=0, Bottom=255. So Y dir = Tilt dir.
  const tiltVal = pctY * 255; 

  const allFixtures = panTiltFixtures.value.map(fd => fd.fixture);
  emit('before-change', allFixtures);

  for (const fd of panTiltFixtures.value) {
    padStepValues(fd.panCh, panVal);
    padStepValues(fd.tiltCh, tiltVal);
  }
}

function startPadDrag(e: MouseEvent | TouchEvent) {
  if ('button' in e && e.button !== 0) return;
  e.preventDefault();
  isDraggingPad.value = true;
  
  const allFixtures = panTiltFixtures.value.map(fd => fd.fixture);
  currentDragSnapshots = captureSnapshots(allFixtures);
  
  updatePanTiltFromEvent(e);

  window.addEventListener('mousemove', onPadDrag);
  window.addEventListener('mouseup', stopPadDrag);
  window.addEventListener('touchmove', onPadDrag, { passive: false });
  window.addEventListener('touchend', stopPadDrag);
}

function onPadDrag(e: MouseEvent | TouchEvent) {
  if (!isDraggingPad.value) return;
  e.preventDefault(); 
  updatePanTiltFromEvent(e);
}

function stopPadDrag(e: MouseEvent | TouchEvent) {
  if (!isDraggingPad.value) return;
  isDraggingPad.value = false;
  
  window.removeEventListener('mousemove', onPadDrag);
  window.removeEventListener('mouseup', stopPadDrag);
  window.removeEventListener('touchmove', onPadDrag);
  window.removeEventListener('touchend', stopPadDrag);

  if (currentDragSnapshots) {
    commitSnapshots(currentDragSnapshots, 'Pan/Tilt XY Pad Change');
    currentDragSnapshots = null;
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onPadDrag);
  window.removeEventListener('mouseup', stopPadDrag);
  window.removeEventListener('touchmove', onPadDrag);
  window.removeEventListener('touchend', stopPadDrag);
});

// ─── Handle Position Calculation ──────────────────────────────────────────

const handleStyle = computed(() => {
  const { pan, tilt } = avgPanTilt.value;
  // pan is 0-255 mapped to 0-100% left
  // tilt is 0-255 mapped from Top (0) to Bottom (255)
  const pctX = (pan / 255) * 100;
  const pctY = (tilt / 255) * 100;

  return {
    left: `${pctX}%`,
    top: `${pctY}%`
  };
});

</script>

<template>
  <div v-if="hasPanTilt" class="mb-6 space-y-4">
    <div class="flex justify-center my-4">
      <div 
        ref="padContainer"
        class="relative w-48 h-48 rounded-xl bg-accent border border-border cursor-crosshair touch-none select-none shadow-inner"
        @mousedown="startPadDrag"
        @touchstart="startPadDrag"
      >
        <!-- Grid lines for visual guidance -->
        <div class="absolute inset-0 pointer-events-none opacity-30">
          <div class="absolute top-1/2 left-0 right-0 h-px bg-white/20"></div>
          <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/20"></div>
          
          <div class="absolute top-1/4 left-0 right-0 h-px bg-white/5"></div>
          <div class="absolute top-3/4 left-0 right-0 h-px bg-white/5"></div>
          <div class="absolute left-1/4 top-0 bottom-0 w-px bg-white/5"></div>
          <div class="absolute left-3/4 top-0 bottom-0 w-px bg-white/5"></div>

          <!-- Target ring -->
          <div class="absolute top-1/2 left-1/2 -ml-12 -mt-12 w-24 h-24 rounded-full border border-white/10"></div>
        </div>
        
        <!-- Handle -->
        <div 
          class="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border border-white shadow-md pointer-events-none bg-primary flex items-center justify-center transition-transform duration-75"
          :style="handleStyle"
          :class="isDraggingPad ? 'scale-110' : 'scale-100'"
        >
          <div class="w-2 h-2 rounded-full bg-white/80"></div>
        </div>
      </div>
    </div>
  </div>
</template>
