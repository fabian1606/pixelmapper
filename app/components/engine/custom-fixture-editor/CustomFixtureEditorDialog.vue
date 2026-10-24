<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-vue-next';
import { Fixture } from '~/utils/engine/core/fixture';

import CustomFixtureHeader from './Header/CustomFixtureHeader.vue';
import CustomFixtureSidebar from './Sidebar/CustomFixtureSidebar.vue';
import CustomFixtureCanvas from './Canvas/CustomFixtureCanvas.vue';
import CustomFixtureChannelEditor from './ChannelEditor/CustomFixtureChannelEditor.vue';
import AiEnrichmentReview from './AiEnrichmentReview.vue';

import { useCustomFixtureForm } from '~/composables/engine/useCustomFixtureForm';
import { useAiFixtureEnrichment, type EnrichmentProposal } from '~/composables/engine/useAiFixtureEnrichment';

import { buildOflFixture, initFromOflFixture } from '~/utils/engine/custom-fixture-omapping';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import { computeHeadElementCentroids } from '~/utils/engine/svg-element-positions';
import { applyEnrichmentProposals } from '~/utils/engine/enrichment-apply';
import { parseOflFixtureJson } from '~/utils/fixture-definitions/ofl-import';
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
  headCountManual, useCustomSvg, customSvgData, customSvgError,
  activeHeadKey, headToElementMap, suggestedMapping,
  hoveredElementId, hoveredHeadKey, headKeys, highlightedElementIds, headCount,
  handleUploadSvg, assignElementToActiveHead, clearHeadAssignment, setUseCustomSvg,
  applySuggestedMapping, clearSuggestedMapping,
} = useCustomFixtureForm();

// AI Processing State
const aiUploadPending = ref(false);
const isExtracting = ref(false);
const extractStatus = ref('Analyzing PDF...');
const extractError = ref('');

const runtimeConfig = useRuntimeConfig();

// AI Enrichment State — compares the current draft against a manual PDF and
// proposes corrections to shutter/dimmer/wheel-slot behavior for review.
const { isEnriching, enrichStatus, enrichError, proposals, enrichFromManual } = useAiFixtureEnrichment();
const reviewDialogOpen = ref(false);
const enrichFileInput = ref<HTMLInputElement | null>(null);

/**
 * Loads an OFL fixture definition into the form state. Shared by every flow
 * that fills the editor from OFL: edit, AI PDF extraction, AI enrichment and
 * the OFL JSON import.
 */
function applyOflToForm(ofl: OflFixture) {
  const init = initFromOflFixture(ofl);
  Object.assign(formState, init.state);
  channels.value = init.channels;
  modes.value = init.modes;
  wheels.value = init.wheels;
  fixtureCategory.value = init.category;
  pixelColumns.value = init.pixelCols;
  pixelRows.value = init.pixelRows;
  headCountManual.value = init.headCount;
  useCustomSvg.value = init.useCustomSvg;
  customSvgData.value = init.customSvgData;
  headToElementMap.value = init.headToElementMap;
}

// OFL JSON import (plan M4.7): readable error shown under the header.
const importError = ref('');

/** Reads, validates and loads an OFL fixture `.json` file into the form. */
async function handleOflJsonImport(file: File) {
  importError.value = '';
  try {
    const result = parseOflFixtureJson(await file.text());
    if (!result.ok) {
      importError.value = `Could not import "${file.name}": ${result.error}`;
      return;
    }
    applyOflToForm(result.fixture);
    // Leave a pending AI upload screen and start at the first step.
    aiUploadPending.value = false;
    extractError.value = '';
    selectedChannelId.value = null;
    currentStepIdx.value = 0;
  } catch (err) {
    console.error('[custom-fixture-editor] OFL JSON import failed:', err);
    const detail = err instanceof Error ? err.message : String(err);
    importError.value = `Could not import "${file.name}": ${detail}`;
  }
}

function currentDraftAsOfl(): OflFixture {
  const headPositions =
    useCustomSvg.value && customSvgData.value && Object.keys(headToElementMap.value).length > 0
      ? computeHeadElementCentroids(customSvgData.value, headToElementMap.value)
      : {};
  return buildOflFixture(
    formState, channels.value, modes.value, wheels.value,
    fixtureCategory.value, pixelColumns.value, pixelRows.value,
    customSvgData.value, headToElementMap.value, headCountManual.value, useCustomSvg.value,
    headPositions,
  );
}

function startEnrichment() {
  enrichFileInput.value?.click();
}

async function handleEnrichPdfUpload(file: File) {
  reviewDialogOpen.value = true;
  await enrichFromManual(currentDraftAsOfl(), file);
}

function applyProposals(accepted: EnrichmentProposal[]) {
  if (accepted.length === 0) return;
  const patched = applyEnrichmentProposals(currentDraftAsOfl(), accepted);
  applyOflToForm(patched);
}

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
              applyOflToForm(json.data);
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
    importError.value = '';
    isExtracting.value = false;
    if (props.startWithAiUpload) {
      // Clear data first
      channels.value = [];
      modes.value = [];
      wheels.value = [];
      customSvgData.value = null;
      headCountManual.value = 1;
      useCustomSvg.value = false;
      headToElementMap.value = {};
      aiUploadPending.value = true;
    } else if (props.fixtureToEdit) {
      try {
        applyOflToForm(props.fixtureToEdit);
        currentStepIdx.value = 0;
      } catch (err: any) {
        console.error('Failed to init from OFL Fixture:', err);
        alert('An error occurred while loading the fixture: ' + err.message);
        emit('update:open', false);
      }
    } else {
      customSvgData.value = null;
      headCountManual.value = 1;
      useCustomSvg.value = false;
      headToElementMap.value = {};
    }
  }
});

function goNext() {
  if (!isLastStep.value) currentStepIdx.value++;
  else handleSave();
}

function handleSave() {
  // Compute SVG element centroids so fixture-factory can position beams
  // correctly (e.g. circular arrangement instead of uniform grid).
  const headPositions =
    useCustomSvg.value && customSvgData.value && Object.keys(headToElementMap.value).length > 0
      ? computeHeadElementCentroids(customSvgData.value, headToElementMap.value)
      : {};

  const ofl = buildOflFixture(
    formState, channels.value, modes.value, wheels.value,
    fixtureCategory.value, pixelColumns.value, pixelRows.value,
    customSvgData.value, headToElementMap.value, headCountManual.value, useCustomSvg.value,
    headPositions,
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
        :can-import="!isExtracting"
        @update:current-step-idx="i => currentStepIdx = i"
        @import-ofl-json="handleOflJsonImport"
      />

      <!-- OFL JSON import error (plan M4.7) -->
      <div
        v-if="importError"
        role="alert"
        class="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive"
      >
        <span class="flex-1">{{ importError }}</span>
        <button class="shrink-0 underline underline-offset-4 hover:opacity-80" @click="importError = ''">
          Dismiss
        </button>
      </div>

      <div
        v-if="props.fixtureToEdit && !aiUploadPending && !isExtracting"
        class="flex justify-end px-4 pt-2"
      >
        <button
          class="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
          @click="startEnrichment"
        >
          Verify with AI (compare against manual)
        </button>
        <input
          ref="enrichFileInput"
          type="file"
          accept="application/pdf"
          class="hidden"
          @change="(e) => {
            const target = e.target as HTMLInputElement;
            if (target.files?.length) handleEnrichPdfUpload(target.files[0] as File);
            target.value = '';
          }"
        />
      </div>

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
          :head-count="headCount"
          :use-custom-svg="useCustomSvg"
          :customSvgData="customSvgData"
          :customSvgError="customSvgError"
          :highlighted-element-ids="highlightedElementIds"
          :active-head-key="activeHeadKey"
          :head-to-element-map="headToElementMap"
          :suggested-mapping="suggestedMapping"
          :suggested-mapping-ids="suggestedMappingIds"
          :is-previewing-mapping="isPreviewingMapping"
          :hovered-element-id="hoveredElementId"
          :hovered-head-key="hoveredHeadKey"
          @update:hovered-element-id="hoveredElementId = $event"
          @upload-svg="handleUploadSvg"
          @update:use-custom-svg="setUseCustomSvg"
          @assign-element-to-active-head="assignElementToActiveHead"
          @apply-suggested-mapping="applySuggestedMapping"
          @clear-suggested-mapping="clearSuggestedMapping"
          @clear-svg="customSvgData = null; setUseCustomSvg(false)"
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
          v-model:headCount="headCountManual"
          :use-custom-svg="useCustomSvg"
          :head-keys="headKeys"
          :active-head-key="activeHeadKey"
          :head-to-element-map="headToElementMap"
          :hovered-element-id="hoveredElementId"
          :hovered-head-key="hoveredHeadKey"
          :suggested-mapping="suggestedMapping"
          :is-previewing-mapping="isPreviewingMapping"
          @update:is-previewing-mapping="isPreviewingMapping = $event"
          @update:hovered-head-key="hoveredHeadKey = $event"
          :is-last-step="isLastStep"
          @update:active-head-key="activeHeadKey = $event"
          @clear-head-assignment="clearHeadAssignment"
          @apply-suggested-mapping="applySuggestedMapping"
          @clear-suggested-mapping="clearSuggestedMapping"
          @next="goNext"
        />
      </div>
    </DialogContent>
  </Dialog>

  <AiEnrichmentReview
    :open="reviewDialogOpen"
    :is-enriching="isEnriching"
    :status="enrichStatus"
    :error="enrichError"
    :proposals="proposals"
    @update:open="reviewDialogOpen = $event"
    @apply="applyProposals"
  />
</template>
