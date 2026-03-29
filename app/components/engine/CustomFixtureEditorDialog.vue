<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import type { Fixture } from '~/utils/engine/core/fixture';
import {
  FIXTURE_CATEGORIES,
  WHEEL_CAPABILITY_TYPES,
  type OflCategory,
  type CustomFixtureFormState,
  type ChannelDraft,
  type ModeDraft,
  type WheelDraft,
} from '~/utils/engine/custom-fixture-types';
import CustomFixtureSidebar from './CustomFixtureSidebar.vue';
import CustomFixtureCanvas from './CustomFixtureCanvas.vue';
import CustomFixtureChannelEditor from './CustomFixtureChannelEditor.vue';
import { CheckCircle2 } from 'lucide-vue-next';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'add', fixtures: Fixture[]): void;
}>();

// ─── Step management ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 'general',  label: 'General Info' },
  { id: 'channels', label: 'Channels' },
  { id: 'dmx',      label: 'DMX Mapping' },
] as const;

type StepId = typeof STEPS[number]['id'];

const currentStepIdx = ref(0);
const currentStepId = computed<StepId>(() => STEPS[currentStepIdx.value]?.id ?? 'general');
const isLastStep = computed(() => currentStepIdx.value === STEPS.length - 1);

function goNext() {
  if (!isLastStep.value) currentStepIdx.value++;
  else handleSave();
}

function goToStep(i: number) {
  if (i <= currentStepIdx.value) currentStepIdx.value = i;
}

// ─── Form State ───────────────────────────────────────────────────────────────

const formState = reactive<CustomFixtureFormState>({
  fixtureName: '', shortName: '', manufacturer: '', comment: '',
  fixtureWidth: 30, fixtureHeight: 30, fixtureDepth: 30,
  weight: 0, power: 0, dmxConnector: '', bulbType: '',
  colorTemperature: 0, beamAngleMin: 0, beamAngleMax: 0,
});

const headCount = computed(() => {
  const mode = FIXTURE_CATEGORIES[fixtureCategory.value].renderMode;
  if (mode === 'bar') return pixelColumns.value;
  if (mode === 'matrix') return pixelColumns.value * pixelRows.value;
  return 1;
});

const channels = ref<ChannelDraft[]>([]);
const modes = ref<ModeDraft[]>([{ id: 'default', name: 'Default', entries: [] }]);
const selectedChannelId = ref<string | null>(null);
const wheels = ref<WheelDraft[]>([]);

const channelsRaw = ref('1');
const fixtureCategory = ref<OflCategory>('Moving Head');
const pixelColumns = ref(8);
const pixelRows = ref(4);
const customSvgData = ref<string | null>(null);
const headSelections = ref<string[]>([]);

// Auto-create/remove WheelDraft entries as wheel-type channels are added/deleted
watch(
  () => channels.value.filter(c => WHEEL_CAPABILITY_TYPES.has(c.capabilityType)),
  (wheelChannels) => {
    const existingIds = new Set(wheels.value.map(w => w.channelId));
    for (const ch of wheelChannels) {
      if (!existingIds.has(ch.id)) {
        wheels.value.push({
          wheelId:   crypto.randomUUID(),
          channelId: ch.id,
          name:      ch.name,
          direction: undefined,
          slots:     [{ slotId: crypto.randomUUID(), type: 'Open', name: 'Open', colors: [] }],
        });
      }
    }
    const activeIds = new Set(wheelChannels.map(c => c.id));
    wheels.value = wheels.value.filter(w => activeIds.has(w.channelId));
  },
  { deep: true }
);

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleUploadSvg(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result as string;
    if (!result) return;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(result, 'image/svg+xml');
      const shapes = doc.querySelectorAll('path, circle, rect, polygon, ellipse, g');
      let counter = 0;
      shapes.forEach(shape => {
        if (!shape.id) shape.id = `svg-shape-${counter++}-${Math.random().toString(36).slice(2, 7)}`;
      });
      customSvgData.value = new XMLSerializer().serializeToString(doc.documentElement);
      headSelections.value = [];
    } catch (err) {
      console.error('Error parsing uploaded SVG:', err);
      customSvgData.value = result;
    }
  };
  reader.readAsText(file);
}

function handleToggleHeadSelection(id: string) {
  const idx = headSelections.value.indexOf(id);
  if (idx >= 0) headSelections.value.splice(idx, 1);
  else headSelections.value.push(id);
}

function handleSave() {
  console.log('Save custom fixture:', { ...formState, channels: channels.value, modes: modes.value, wheels: wheels.value });
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent
      class="!max-w-[1400px] !w-[96vw] !h-[72vh] p-0 overflow-hidden bg-background border-none shadow-2xl flex flex-col"
    >
      <!-- ── Header + Step Progress Bar ──────────────────────────────────── -->
      <div class="shrink-0 border-b bg-muted/20">
        <div class="px-6 pt-4 pb-3">
          <h2 class="text-base font-bold tracking-tight">Create Custom Fixture</h2>
        </div>
        <div class="flex items-stretch border-t">
          <button
            v-for="(step, i) in STEPS" :key="step.id"
            class="flex-1 flex items-center gap-2.5 px-5 py-3 text-sm font-medium transition-colors relative"
            :class="[
              i === currentStepIdx ? 'text-foreground bg-background'
                : i < currentStepIdx ? 'text-muted-foreground hover:text-foreground'
                : 'text-muted-foreground/40 cursor-default',
            ]"
            :disabled="i > currentStepIdx"
            @click="goToStep(i)"
          >
            <span v-if="i === currentStepIdx" class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            <CheckCircle2 v-if="i < currentStepIdx" class="size-4 text-primary shrink-0" />
            <span v-else
              class="size-4 rounded-full border-2 shrink-0 flex items-center justify-center text-[10px] font-bold"
              :class="i === currentStepIdx ? 'border-primary text-primary' : 'border-muted-foreground/30'"
            >{{ i + 1 }}</span>
            {{ step.label }}
          </button>
        </div>
      </div>

      <!-- ── Main Layout ─────────────────────────────────────────────────── -->
      <div class="flex flex-1 min-h-0">
        <CustomFixtureChannelEditor
          v-if="currentStepId === 'channels'"
          :channels="channels"
          :modes="modes"
          :selected-channel-id="selectedChannelId"
          :head-count="headCount"
          :wheels="wheels"
          @update:channels="channels = $event"
          @update:modes="modes = $event"
          @update:selected-channel-id="selectedChannelId = $event"
          @update:wheels="wheels = $event"
          @next="goNext"
        />

        <CustomFixtureCanvas
          v-else
          :fixtureCategory="fixtureCategory"
          :fixtureWidth="formState.fixtureWidth"
          :fixtureHeight="formState.fixtureHeight"
          :pixelColumns="pixelColumns"
          :pixelRows="pixelRows"
          :customSvgData="customSvgData"
          :headSelections="headSelections"
          @uploadSvg="handleUploadSvg"
          @toggleHeadSelection="handleToggleHeadSelection"
        />

        <CustomFixtureSidebar
          v-if="currentStepId !== 'channels'"
          :current-step="currentStepIdx"
          :form-state="formState"
          @update:form-state="Object.assign(formState, $event)"
          v-model:channelsRaw="channelsRaw"
          v-model:fixtureCategory="fixtureCategory"
          v-model:pixelColumns="pixelColumns"
          v-model:pixelRows="pixelRows"
          :is-last-step="isLastStep"
          :channels="channels"
          :selected-channel-id="selectedChannelId"
          @update:channels="channels = $event"
          @uploadSvg="handleUploadSvg"
          @next="goNext"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
