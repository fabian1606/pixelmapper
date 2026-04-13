<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-vue-next';
import { ref } from 'vue';
import type { OflCategory, CustomFixtureFormState } from '~/utils/engine/custom-fixture-types';
import SidebarGeneralInfo from './SidebarGeneralInfo.vue';
import SidebarDmxInfo from './SidebarDmxInfo.vue';

interface Props {
  currentStep: number;
  formState: CustomFixtureFormState;
  channelsRaw: string;
  fixtureCategory: OflCategory;
  pixelColumns: number;
  pixelRows: number;
  headCount: number;
  useCustomSvg: boolean;
  headKeys: string[];
  activeHeadKey: string;
  headToElementMap: Record<string, string>;
  isLastStep: boolean;
  hoveredElementId?: string | null;
  hoveredHeadKey?: string | null;
  suggestedMapping?: Record<string, string>;
  isPreviewingMapping?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
  (e: 'update:channelsRaw', value: string): void;
  (e: 'update:fixtureCategory', value: OflCategory): void;
  (e: 'update:pixelColumns', value: number): void;
  (e: 'update:pixelRows', value: number): void;
  (e: 'update:headCount', value: number): void;
  (e: 'update:activeHeadKey', value: string): void;
  (e: 'clearHeadAssignment', headKey: string): void;
  (e: 'next'): void;
  (e: 'update:hoveredHeadKey', key: string | null): void;
  (e: 'applySuggestedMapping'): void;
  (e: 'clearSuggestedMapping'): void;
  (e: 'update:isPreviewingMapping', value: boolean): void;
}>();

const generalInfoRef = ref<InstanceType<typeof SidebarGeneralInfo> | null>(null);

function handleNext() {
  if (props.currentStep === 0) {
    if (!generalInfoRef.value?.validate()) return;
  }
  emit('next');
}
</script>

<template>
  <div class="w-72 border-l bg-muted/10 shrink-0 flex flex-col h-full">
    <div class="p-4 flex-1 overflow-y-auto">
      <!-- Step 1: General Info -->
      <SidebarGeneralInfo
        v-if="currentStep === 0"
        ref="generalInfoRef"
        :form-state="formState"
        :fixture-category="fixtureCategory"
        :pixel-columns="pixelColumns"
        :pixel-rows="pixelRows"
        :head-count="headCount"
        :use-custom-svg="useCustomSvg"
        :head-keys="headKeys"
        :active-head-key="activeHeadKey"
        :head-to-element-map="headToElementMap"
        :hovered-element-id="hoveredElementId"
        :hovered-head-key="hoveredHeadKey"
        :suggested-mapping="suggestedMapping"
        :is-previewing-mapping="isPreviewingMapping"
        @update:form-state="emit('update:formState', $event)"
        @update:fixture-category="emit('update:fixtureCategory', $event)"
        @update:pixel-columns="emit('update:pixelColumns', $event)"
        @update:pixel-rows="emit('update:pixelRows', $event)"
        @update:head-count="emit('update:headCount', $event)"
        @update:active-head-key="emit('update:activeHeadKey', $event)"
        @clear-head-assignment="emit('clearHeadAssignment', $event)"
        @update:hovered-head-key="emit('update:hoveredHeadKey', $event)"
        @apply-suggested-mapping="emit('applySuggestedMapping')"
        @clear-suggested-mapping="emit('clearSuggestedMapping')"
        @update:is-previewing-mapping="emit('update:isPreviewingMapping', $event)"
      />

      <!-- Step 3: DMX Mapping Summary -->
      <SidebarDmxInfo
        v-else
        :channels-raw="channelsRaw"
        @update:channels-raw="emit('update:channelsRaw', $event)"
      />
    </div>

    <!-- Bottom action button -->
    <div class="p-4 border-t bg-background shrink-0">
      <Button class="w-full gap-2 h-9" @click="handleNext">
        <Save v-if="isLastStep" class="size-4" />
        {{ isLastStep ? 'Save Fixture' : 'Next →' }}
      </Button>
    </div>
  </div>
</template>
