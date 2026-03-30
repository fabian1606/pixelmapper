<script setup lang="ts">
import { ref, computed } from 'vue';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Fixture } from '~/utils/engine/core/fixture';

import CustomFixtureHeader from './Header/CustomFixtureHeader.vue';
import CustomFixtureSidebar from './Sidebar/CustomFixtureSidebar.vue';
import CustomFixtureCanvas from './Canvas/CustomFixtureCanvas.vue';
import CustomFixtureChannelEditor from './ChannelEditor/CustomFixtureChannelEditor.vue';

import { useCustomFixtureForm } from '~/composables/engine/useCustomFixtureForm';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'add', fixtures: Fixture[]): void;
}>();

const STEPS = [
  { id: 'general',  label: 'General Info' },
  { id: 'channels', label: 'Channels' },
  { id: 'dmx',      label: 'DMX Mapping' },
] as const;

const currentStepIdx = ref(0);
const currentStepId = computed(() => STEPS[currentStepIdx.value]?.id ?? 'general');
const isLastStep = computed(() => currentStepIdx.value === STEPS.length - 1);

const {
  formState, channels, modes, selectedChannelId, wheels,
  channelsRaw, fixtureCategory, pixelColumns, pixelRows,
  customSvgData, headSelections, headCount,
  handleUploadSvg, handleToggleHeadSelection
} = useCustomFixtureForm();

function goNext() {
  if (!isLastStep.value) currentStepIdx.value++;
  else handleSave();
}

function handleSave() {
  console.log('Save custom fixture:', { 
    ...formState, 
    channels: channels.value, 
    modes: modes.value, 
    wheels: wheels.value 
  });
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent
      class="!max-w-[1400px] !w-[96vw] !h-[72vh] p-0 overflow-hidden bg-background border-none shadow-2xl flex flex-col"
    >
      <CustomFixtureHeader 
        :steps="STEPS" 
        :current-step-idx="currentStepIdx" 
        @update:current-step-idx="i => currentStepIdx = i" 
      />

      <div class="flex flex-1 min-h-0">
        <CustomFixtureChannelEditor
          v-if="currentStepId === 'channels'"
          v-model:channels="channels"
          v-model:modes="modes"
          v-model:selected-channel-id="selectedChannelId"
          v-model:wheels="wheels"
          :head-count="headCount"
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
          @next="goNext"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
