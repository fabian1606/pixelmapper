<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { ref, computed } from 'vue';
import {
  FIXTURE_CATEGORIES,
  CATEGORY_OPTIONS,
  Step1Schema,
  type OflCategory,
  type CustomFixtureFormState,
} from '~/utils/engine/custom-fixture-types';
import SidebarGeneralInfoBasic from './SidebarGeneralInfoBasic.vue';
import SidebarGeneralInfoTech from './SidebarGeneralInfoTech.vue';

interface Props {
  formState: CustomFixtureFormState;
  fixtureCategory: OflCategory;
  pixelColumns: number;
  pixelRows: number;
  headCount: number;
  useCustomSvg: boolean;
  headKeys: string[];
  activeHeadKey: string;
  headToElementMap: Record<string, string>;
  hoveredElementId?: string | null;
  hoveredHeadKey?: string | null;
  suggestedMapping?: Record<string, string>;
  isPreviewingMapping?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
  (e: 'update:fixtureCategory', value: OflCategory): void;
  (e: 'update:pixelColumns', value: number): void;
  (e: 'update:pixelRows', value: number): void;
  (e: 'update:headCount', value: number): void;
  (e: 'update:activeHeadKey', value: string): void;
  (e: 'clearHeadAssignment', headKey: string): void;
  (e: 'update:hoveredHeadKey', key: string | null): void;
  (e: 'applySuggestedMapping'): void;
  (e: 'clearSuggestedMapping'): void;
  (e: 'update:isPreviewingMapping', value: boolean): void;
}>();

const fieldErrors = ref<Record<string, string>>({});
const showPixelDensity = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].hasPixelDensity);
const isBar = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode === 'bar');

defineExpose({
  validate() {
    const result = Step1Schema.safeParse(props.formState);
    if (!result.success) {
      fieldErrors.value = Object.fromEntries(
        result.error.issues.map((e: import('zod').ZodIssue) => [String(e.path[0]), e.message])
      );
      return false;
    }
    fieldErrors.value = {};
    return true;
  }
});
</script>

<template>
  <div class="space-y-4">
    <SidebarGeneralInfoBasic :form-state="formState" :field-errors="fieldErrors" @update:form-state="emit('update:formState', $event)" />
    
    <SidebarGeneralInfoTech :form-state="formState" @update:form-state="emit('update:formState', $event)" />

    <!-- Fixture Type -->
    <div class="space-y-2">
      <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60 pt-2">Fixture Type</p>
      <Select :model-value="fixtureCategory" @update:model-value="emit('update:fixtureCategory', $event as OflCategory)">
        <SelectTrigger class="h-8 text-sm"><SelectValue placeholder="Select category" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="cat in CATEGORY_OPTIONS" :key="cat" :value="cat" class="text-xs">
            {{ FIXTURE_CATEGORIES[cat].label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <div v-if="showPixelDensity" class="grid grid-cols-2 gap-2">
        <DraggableNumberInput :label="isBar ? 'Pixels' : 'Columns'" :model-value="pixelColumns" @update:model-value="emit('update:pixelColumns', $event)" :min="1" :max="64" :step="1" />
        <DraggableNumberInput v-if="!isBar" label="Rows" :model-value="pixelRows" @update:model-value="emit('update:pixelRows', $event)" :min="1" :max="64" :step="1" />
      </div>

      <div class="space-y-2 rounded-md border border-border/50 p-2">
        <DraggableNumberInput
          label="Heads"
          :model-value="headCount"
          :min="1"
          :max="128"
          :step="1"
          @update:model-value="emit('update:headCount', $event)"
        />

        <div v-if="useCustomSvg" class="space-y-1.5 pt-1">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Head Mapping</p>
            
            <button
              v-if="suggestedMapping && Object.keys(suggestedMapping).length > 0"
              type="button"
              class="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary text-[10px] font-bold border border-primary/20 transition-all flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-300"
              @click="emit('applySuggestedMapping')"
              @mouseenter="emit('update:isPreviewingMapping', true)"
              @mouseleave="emit('update:isPreviewingMapping', false)"
            >
              🪄 Auto-Map {{ Object.keys(suggestedMapping || {}).length }}
            </button>
          </div>

          <div
            v-for="headKey in headKeys"
            :key="headKey"
            class="rounded-md border px-2 py-1.5 transition-colors"
            :class="[
              activeHeadKey === headKey ? 'border-primary/60 bg-primary/5' : 'border-border/50 bg-background/60',
              (hoveredHeadKey === headKey || (headToElementMap[headKey] && hoveredElementId === headToElementMap[headKey])) ? 'ring-1 ring-primary/40' : ''
            ]"
            @mouseenter="emit('update:hoveredHeadKey', headKey)"
            @mouseleave="emit('update:hoveredHeadKey', null)"
          >
            <div class="flex items-center justify-between gap-2">
              <button
                type="button"
                class="text-left text-[11px] font-medium flex-1"
                @click="emit('update:activeHeadKey', headKey)"
              >
                {{ headKey }}
              </button>
              <button
                type="button"
                class="text-[10px] text-muted-foreground hover:text-foreground"
                :disabled="!headToElementMap[headKey]"
                @click="emit('clearHeadAssignment', headKey)"
              >
                Clear
              </button>
            </div>
            <p class="text-[10px] text-muted-foreground truncate">
              {{ headToElementMap[headKey] || 'Not assigned yet' }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
