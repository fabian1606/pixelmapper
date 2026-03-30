<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { 
  type CustomFixtureFormState,
  GENERAL_INFO_FIELDS,
  DMX_CONNECTORS,
  type FormFieldDescriptor,
} from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  formState: CustomFixtureFormState;
}>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
}>();

function set(key: keyof CustomFixtureFormState, value: unknown) {
  emit('update:formState', { [key]: value } as Partial<CustomFixtureFormState>);
}

const techFields = GENERAL_INFO_FIELDS.filter(f => f.section && f.section !== 'General');

function sectionLabel(fields: FormFieldDescriptor[], idx: number): string | undefined {
  const f = fields[idx];
  if (!f?.section) return undefined;
  const prev = fields[idx - 1];
  return (prev?.section ?? '') !== f.section ? f.section : undefined;
}
</script>

<template>
  <div class="space-y-2">
    <template v-for="(field, idx) in techFields" :key="idx">
      <p v-if="sectionLabel(techFields, idx)" class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60 pt-3">{{ sectionLabel(techFields, idx) }}</p>

      <DraggableNumberInput
        v-if="field.kind === 'number' && field.key"
        :label="field.dragLabel" :unit="field.unit"
        :model-value="(formState[field.key as keyof CustomFixtureFormState] as number)"
        @update:model-value="set(field.key as keyof CustomFixtureFormState, $event)"
        :min="field.min" :max="field.max" :step="field.step"
      />

      <div v-else-if="field.kind === 'number-pair'" class="grid grid-cols-2 gap-2">
        <DraggableNumberInput
          :label="field.dragLabels[0]" :unit="field.units?.[0]"
          :model-value="(formState[field.keys[0] as keyof CustomFixtureFormState] as number)"
          @update:model-value="set(field.keys[0] as keyof CustomFixtureFormState, $event)"
          :min="field.min" :max="field.max" :step="field.step"
        />
        <DraggableNumberInput
          :label="field.dragLabels[1]" :unit="field.units?.[1]"
          :model-value="(formState[field.keys[1] as keyof CustomFixtureFormState] as number)"
          @update:model-value="set(field.keys[1] as keyof CustomFixtureFormState, $event)"
          :min="field.min" :max="field.max" :step="field.step"
        />
      </div>

      <Select
        v-else-if="field.kind === 'select' && field.key"
        :model-value="(formState[field.key as keyof CustomFixtureFormState] as string) || '_none'"
        @update:model-value="set(field.key as keyof CustomFixtureFormState, $event === '_none' ? '' : $event)"
      >
        <SelectTrigger class="h-8 text-sm"><SelectValue :placeholder="field.placeholder" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-if="field.noneLabel" value="_none" class="text-xs text-muted-foreground">{{ field.noneLabel }}</SelectItem>
          <SelectItem v-for="opt in field.options" :key="opt" :value="opt" class="text-xs">{{ opt }}</SelectItem>
        </SelectContent>
      </Select>
    </template>
  </div>
</template>
