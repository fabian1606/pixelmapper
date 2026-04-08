<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-vue-next';
import { Fixture } from '~/utils/engine/core/fixture';

import CustomFixtureHeader from './Header/CustomFixtureHeader.vue';
import CustomFixtureSidebar from './Sidebar/CustomFixtureSidebar.vue';
import CustomFixtureCanvas from './Canvas/CustomFixtureCanvas.vue';
import CustomFixtureChannelEditor from './ChannelEditor/CustomFixtureChannelEditor.vue';

import { useCustomFixtureForm } from '~/composables/engine/useCustomFixtureForm';

import { buildOflFixture, initFromOflFixture } from '~/utils/engine/custom-fixture-omapping';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import type { OflFixture } from '~/utils/ofl/types';

const props = defineProps<{ 
  open: boolean;
  fixtureToEdit?: OflFixture | null;
  startWithAiUpload?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'add', fixtures: Fixture[]): void;
  (e: 'update-type', ofl: OflFixture): void;
}>();

const STEPS = [
  { id: 'general',  label: 'General Info' },
  { id: 'channels', label: 'Channels' },
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

// AI Processing State
const aiUploadPending = ref(false);
const isExtracting = ref(false);
const extractStatus = ref('Analyzing PDF...');
const extractError = ref('');

const runtimeConfig = useRuntimeConfig();

async function handleAIPdfUpload(file: File) {
  aiUploadPending.value = false;
  isExtracting.value = true;
  extractStatus.value = 'Uploading PDF...';
  extractError.value = '';

  try {
    const formData = new FormData();
    formData.append('manualPdf', file);

    const baseUrl = runtimeConfig.public.aiBackendUrl || 'http://localhost:4000';
    const response = await fetch(`${baseUrl}/extract-fixture-pdf`, {
      method: 'POST',
      body: formData,
    });

    if (!response.body) throw new Error('No response body from server.');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Buffer accumulates incomplete lines across chunks
    let buffer = '';
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      // Append decoded chunk to buffer and split on double newlines (SSE event boundary)
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      
      // All parts except the last are complete SSE events; the last may be incomplete
      buffer = parts.pop() ?? '';
      
      for (const part of parts) {
        // Each SSE event block may contain multiple lines; find the data: line
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(line.substring(6));
            if (json.status) {
              extractStatus.value = json.status;
            } else if (json.success && json.data) {
              const init = initFromOflFixture(json.data);
              Object.assign(formState, init.state);
              channels.value = init.channels;
              modes.value = init.modes;
              wheels.value = init.wheels;
              fixtureCategory.value = init.category;
              pixelColumns.value = init.pixelCols;
              pixelRows.value = init.pixelRows;
              currentStepIdx.value = 0;
            } else if (json.error) {
              extractError.value = json.error;
            }
          } catch (e) {
            // Ignore parse errors on incomplete chunks
          }
        }
      }
    }
  } catch (err: any) {
    console.error('AI Extraction Error:', err);
    extractError.value = err.message || 'An error occurred during extraction.';
  } finally {
    isExtracting.value = false;
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    aiUploadPending.value = false;
    extractError.value = '';
    isExtracting.value = false;
    if (props.startWithAiUpload) {
      // Clear data first
      channels.value = [];
      modes.value = [];
      wheels.value = [];
      aiUploadPending.value = true;
    } else if (props.fixtureToEdit) {
      try {
        const init = initFromOflFixture(props.fixtureToEdit);
        Object.assign(formState, init.state);
        channels.value = init.channels;
        modes.value = init.modes;
        wheels.value = init.wheels;
        fixtureCategory.value = init.category;
        pixelColumns.value = init.pixelCols;
        pixelRows.value = init.pixelRows;
        currentStepIdx.value = 0;
      } catch (err: any) {
        console.error('Failed to init from OFL Fixture:', err);
        alert('An error occurred while loading the fixture: ' + err.message);
        emit('update:open', false);
      }
    }
  }
});

function goNext() {
  if (!isLastStep.value) currentStepIdx.value++;
  else handleSave();
}

function handleSave() {
  const ofl = buildOflFixture(
    formState, channels.value, modes.value, wheels.value, 
    fixtureCategory.value, pixelColumns.value, pixelRows.value, customSvgData.value
  );

  if (props.fixtureToEdit) {
    emit('update-type', ofl);
  } else {
    emit('add', [createFixtureFromOfl(ofl)]);
  }

  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="val => emit('update:open', val)">
    <DialogContent
      class="!max-w-[1400px] !w-[96vw] !h-[72vh] p-0 overflow-hidden bg-background border-none shadow-2xl flex flex-col gap-0"
    >
      <CustomFixtureHeader 
        :steps="STEPS" 
        :current-step-idx="currentStepIdx" 
        @update:current-step-idx="i => currentStepIdx = i" 
      />

      <div class="flex flex-1 min-h-0 relative">
        <template v-if="aiUploadPending">
          <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm gap-4 p-8">
            <div class="w-full max-w-md text-center flex flex-col items-center gap-6">
              <div class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <span class="text-3xl">🪄</span> AI PDF Import
              </div>
              <p class="text-muted-foreground text-sm">
                Upload a user manual (DMX charts, specifications) to automatically generate the fixture.
              </p>
              
              <label class="w-full relative group cursor-pointer">
                <div class="absolute inset-0 bg-primary/5 rounded-xl border-2 border-dashed border-primary/20 group-hover:border-primary/50 group-hover:bg-primary/10 transition-colors"></div>
                <div class="px-6 py-12 flex flex-col items-center justify-center gap-3 relative z-10">
                  <div class="size-12 rounded-full bg-background shadow-sm border flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                     <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                  </div>
                  <div class="font-medium text-foreground">Select PDF file...</div>
                  <div class="text-xs text-muted-foreground">Click or drag and drop here</div>
                </div>
                <!-- File input -->
                <input 
                  type="file" 
                  accept="application/pdf"
                  class="hidden" 
                  @change="(e) => {
                    const target = e.target as HTMLInputElement;
                    if (target.files?.length) handleAIPdfUpload(target.files[0] as File);
                  }"
                />
              </label>
              
              <button class="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4" @click="emit('update:open', false)">
                Cancel
              </button>
            </div>
          </div>
        </template>
        <template v-else-if="isExtracting">
          <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm gap-4">
            <Loader2 class="size-10 animate-spin text-primary" />
            <div class="text-lg font-medium tracking-tight text-foreground">{{ extractStatus }}</div>
            <div class="text-sm text-muted-foreground max-w-md text-center">
              This process may take a few minutes depending on the complexity of the manual.
            </div>
          </div>
        </template>
        <template v-else-if="extractError">
          <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background gap-4 p-8 text-center">
            <div class="size-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
               <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            </div>
            <div class="text-lg font-bold text-foreground">AI Extraction Error</div>
            <div class="text-sm text-muted-foreground">{{ extractError }}</div>
            <button class="px-4 py-2 mt-4 text-sm font-medium bg-secondary text-secondary-foreground rounded-md" @click="emit('update:open', false)">
              Close
            </button>
          </div>
        </template>

        <CustomFixtureChannelEditor
          v-if="currentStepId === 'channels' && !isExtracting && !aiUploadPending"
          v-model:channels="channels"
          v-model:modes="modes"
          v-model:selected-channel-id="selectedChannelId"
          v-model:wheels="wheels"
          :head-count="headCount"
          @next="goNext"
        />

        <CustomFixtureCanvas
          v-else-if="currentStepId !== 'channels' && !isExtracting && !aiUploadPending"
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
          v-if="currentStepId !== 'channels' && !isExtracting && !extractError && !aiUploadPending"
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
