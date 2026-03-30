<script setup lang="ts">
import { Input } from '@/components/ui/input';
import { 
  type CustomFixtureFormState,
  GENERAL_INFO_FIELDS,
} from '~/utils/engine/custom-fixture-types';

const props = defineProps<{
  formState: CustomFixtureFormState;
  fieldErrors: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
}>();

function set(key: keyof CustomFixtureFormState, value: unknown) {
  emit('update:formState', { [key]: value } as Partial<CustomFixtureFormState>);
}

const basicFields = GENERAL_INFO_FIELDS.filter(f => f.section === 'General' || (!f.section && (f.key === 'shortName' || f.key === 'manufacturer' || f.key === 'comment')));
</script>

<template>
  <div class="space-y-2">
    <template v-for="(field, idx) in basicFields" :key="idx">
      <p v-if="field.section" class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60 pt-0">{{ field.section }}</p>
      
      <template v-if="field.kind === 'text' && field.key">
        <Input
          :model-value="(formState[field.key as keyof CustomFixtureFormState] as string)"
          @update:model-value="set(field.key as keyof CustomFixtureFormState, $event)"
          :placeholder="field.placeholder"
          class="h-8 text-sm"
          :class="fieldErrors[field.key] ? 'border-destructive focus-visible:ring-destructive' : ''"
        />
        <p v-if="fieldErrors[field.key]" class="text-[10px] text-destructive -mt-1">{{ fieldErrors[field.key] }}</p>
      </template>

      <textarea
        v-else-if="field.kind === 'textarea' && field.key"
        :value="(formState[field.key as keyof CustomFixtureFormState] as string)"
        @input="set(field.key as keyof CustomFixtureFormState, ($event.target as HTMLTextAreaElement).value)"
        :placeholder="field.placeholder"
        :rows="field.rows ?? 2"
        class="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
      />
    </template>
  </div>
</template>
