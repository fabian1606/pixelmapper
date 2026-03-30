<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Image as ImageIcon } from 'lucide-vue-next';
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
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
  (e: 'update:fixtureCategory', value: OflCategory): void;
  (e: 'update:pixelColumns', value: number): void;
  (e: 'update:pixelRows', value: number): void;
  (e: 'uploadSvg', file: File): void;
}>();

const fieldErrors = ref<Record<string, string>>({});
const showPixelDensity = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].hasPixelDensity);
const isBar = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode === 'bar');
const isCustomSvg = computed(() => props.fixtureCategory === 'Custom SVG');

function handleSvgUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit('uploadSvg', file);
}

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

      <div v-if="isCustomSvg" class="relative">
        <input type="file" accept=".svg" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" @change="handleSvgUpload" />
        <Button variant="outline" size="sm" class="w-full justify-start text-muted-foreground gap-2 text-xs">
          <ImageIcon class="size-3.5" /> Import SVG File…
        </Button>
      </div>
    </div>
  </div>
</template>
