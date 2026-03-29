<script setup lang="ts">
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Save, Image as ImageIcon } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import {
  FIXTURE_CATEGORIES,
  CATEGORY_OPTIONS,
  GENERAL_INFO_FIELDS,
  Step1Schema,
  type OflCategory,
  type CustomFixtureFormState,
  type FormFieldDescriptor,
  type ChannelDraft,
} from '~/utils/engine/custom-fixture-types';

interface Props {
  currentStep: number;
  formState: CustomFixtureFormState;
  channelsRaw: string;
  fixtureCategory: OflCategory;
  pixelColumns: number;
  pixelRows: number;
  isLastStep: boolean;
  channels: ChannelDraft[];
  selectedChannelId: string | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:formState',    value: Partial<CustomFixtureFormState>): void;
  (e: 'update:channelsRaw',  value: string): void;
  (e: 'update:fixtureCategory', value: OflCategory): void;
  (e: 'update:pixelColumns', value: number): void;
  (e: 'update:pixelRows',    value: number): void;
  (e: 'uploadSvg', file: File): void;
  (e: 'update:channels', value: ChannelDraft[]): void;
  (e: 'next'): void;
}>();


const showPixelDensity = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].hasPixelDensity);
const isBar            = computed(() => FIXTURE_CATEGORIES[props.fixtureCategory].renderMode === 'bar');
const isCustomSvg      = computed(() => props.fixtureCategory === 'Custom SVG');

// ─── Validation ───────────────────────────────────────────────────────────────

const fieldErrors = ref<Record<string, string>>({});

function handleNext() {
  if (props.currentStep === 0) {
    const result = Step1Schema.safeParse(props.formState);
    if (!result.success) {
      fieldErrors.value = Object.fromEntries(
        result.error.issues.map((e: import('zod').ZodIssue) => [String(e.path[0]), e.message])
      );
      return;
    }
    fieldErrors.value = {};
  }
  emit('next');
}

function clearError(key: string) {
  if (fieldErrors.value[key]) {
    const { [key]: _, ...rest } = fieldErrors.value;
    fieldErrors.value = rest;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function set(key: keyof CustomFixtureFormState, value: unknown) {
  clearError(key);
  emit('update:formState', { [key]: value } as Partial<CustomFixtureFormState>);
}

function handleSvgUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit('uploadSvg', file);
}

function sectionLabel(fields: FormFieldDescriptor[], idx: number): string | undefined {
  const f = fields[idx];
  if (!f?.section) return undefined;
  const prev = fields[idx - 1];
  return (prev?.section ?? '') !== f.section ? f.section : undefined;
}
</script>

<template>
  <div class="w-72 border-l bg-muted/10 shrink-0 flex flex-col h-full">
    <div class="p-4 flex-1 overflow-y-auto space-y-2">

      <!-- ── STEP 1: General Info — schema-driven ──────────────────────── -->
      <template v-if="currentStep === 0">

        <template v-for="(field, idx) in GENERAL_INFO_FIELDS" :key="idx">

          <!-- Section heading -->
          <p
            v-if="sectionLabel(GENERAL_INFO_FIELDS, idx)"
            class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60"
            :class="idx === 0 ? 'pt-0' : 'pt-3'"
          >{{ sectionLabel(GENERAL_INFO_FIELDS, idx) }}</p>

          <!-- text -->
          <template v-if="field.kind === 'text' && field.key">
            <Input
              :model-value="(formState[field.key as keyof CustomFixtureFormState] as string)"
              @update:model-value="set(field.key as keyof CustomFixtureFormState, $event)"
              :placeholder="field.placeholder"
              class="h-8 text-sm"
              :class="fieldErrors[field.key] ? 'border-destructive focus-visible:ring-destructive' : ''"
            />
            <p v-if="fieldErrors[field.key]" class="text-[10px] text-destructive -mt-1">
              {{ fieldErrors[field.key] }}
            </p>
          </template>

          <!-- textarea -->
          <textarea
            v-else-if="field.kind === 'textarea' && field.key"
            :value="(formState[field.key as keyof CustomFixtureFormState] as string)"
            @input="set(field.key as keyof CustomFixtureFormState, ($event.target as HTMLTextAreaElement).value)"
            :placeholder="field.placeholder"
            :rows="field.rows ?? 2"
            class="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />

          <!-- number -->
          <DraggableNumberInput
            v-else-if="field.kind === 'number' && field.key"
            :label="field.dragLabel"
            :unit="field.unit"
            :model-value="(formState[field.key as keyof CustomFixtureFormState] as number)"
            @update:model-value="set(field.key as keyof CustomFixtureFormState, $event)"
            :min="field.min" :max="field.max" :step="field.step"
          />

          <!-- number-pair -->
          <div v-else-if="field.kind === 'number-pair'" class="grid grid-cols-2 gap-2">
            <DraggableNumberInput
              :label="field.dragLabels[0]"
              :unit="field.units?.[0]"
              :model-value="(formState[field.keys[0] as keyof CustomFixtureFormState] as number)"
              @update:model-value="set(field.keys[0] as keyof CustomFixtureFormState, $event)"
              :min="field.min" :max="field.max" :step="field.step"
            />
            <DraggableNumberInput
              :label="field.dragLabels[1]"
              :unit="field.units?.[1]"
              :model-value="(formState[field.keys[1] as keyof CustomFixtureFormState] as number)"
              @update:model-value="set(field.keys[1] as keyof CustomFixtureFormState, $event)"
              :min="field.min" :max="field.max" :step="field.step"
            />
          </div>

          <!-- select -->
          <Select
            v-else-if="field.kind === 'select' && field.key"
            :model-value="(formState[field.key as keyof CustomFixtureFormState] as string) || '_none'"
            @update:model-value="set(field.key as keyof CustomFixtureFormState, $event === '_none' ? '' : $event)"
          >
            <SelectTrigger class="h-8 text-sm">
              <SelectValue :placeholder="field.placeholder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="field.noneLabel" value="_none" class="text-xs text-muted-foreground">
                {{ field.noneLabel }}
              </SelectItem>
              <SelectItem v-for="opt in field.options" :key="opt" :value="opt" class="text-xs">
                {{ opt }}
              </SelectItem>
            </SelectContent>
          </Select>

        </template>

        <!-- Fixture Type (has special pixel/SVG sub-controls, not in GENERAL_INFO_FIELDS) -->
        <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60 pt-3">Fixture Type</p>
        <Select
          :model-value="fixtureCategory"
          @update:model-value="emit('update:fixtureCategory', $event as OflCategory)"
        >
          <SelectTrigger class="h-8 text-sm">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="cat in CATEGORY_OPTIONS" :key="cat" :value="cat" class="text-xs">
              {{ FIXTURE_CATEGORIES[cat].label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <div v-if="showPixelDensity" class="grid grid-cols-2 gap-2">
          <DraggableNumberInput
            :label="isBar ? 'Pixels' : 'Columns'"
            :model-value="pixelColumns"
            @update:model-value="emit('update:pixelColumns', $event)"
            :min="1" :max="64" :step="1"
          />
          <DraggableNumberInput
            v-if="!isBar"
            label="Rows"
            :model-value="pixelRows"
            @update:model-value="emit('update:pixelRows', $event)"
            :min="1" :max="64" :step="1"
          />
        </div>

        <div v-if="isCustomSvg" class="relative">
          <input
            type="file" accept=".svg"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            @change="handleSvgUpload"
          />
          <Button variant="outline" size="sm" class="w-full justify-start text-muted-foreground gap-2 text-xs">
            <ImageIcon class="size-3.5" />
            Import SVG File…
          </Button>
        </div>

      </template>

      <!-- ── STEP 3: DMX Mapping ───────────────────────────────────────── -->
      <template v-else>
        <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">DMX</p>
        <DraggableNumberInput
          label="Channels"
          :model-value="Number(channelsRaw)"
          @update:model-value="emit('update:channelsRaw', String($event))"
          :min="1" :max="512" :step="1"
        />
        <p class="text-[9px] text-muted-foreground/50">Channel binding will be configured after saving.</p>
      </template>

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
