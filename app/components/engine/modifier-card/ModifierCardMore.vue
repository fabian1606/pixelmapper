<script setup lang="ts">
/**
 * Per-card blend mode under "More" (plan M5.6, M10.2): how this modifier's
 * output combines with the modifiers above it.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BlendMode } from '~/utils/engine/types';

defineProps<{ blendMode: BlendMode }>();

const emit = defineEmits<{
  update: [mode: BlendMode];
  'dropdown-open-change': [open: boolean];
}>();

const MODES: { value: BlendMode; label: string; title: string }[] = [
  { value: 'add', label: 'Add', title: 'Adds its change to the result above' },
  { value: 'override', label: 'Override', title: 'Replaces the result above' },
  { value: 'multiply', label: 'Multiply', title: 'Multiplies the result above' },
  { value: 'max', label: 'Max', title: 'Keeps the brighter value' },
  { value: 'min', label: 'Min', title: 'Keeps the darker value' },
];
</script>

<template>
  <div class="flex items-center gap-2" data-blend-mode>
    <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Blend</span>
    <Select :model-value="blendMode" @update:model-value="v => emit('update', v as BlendMode)" @update:open="v => emit('dropdown-open-change', v)">
      <SelectTrigger class="h-7 flex-1 min-w-0 text-xs" aria-label="Blend mode"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="m in MODES" :key="m.value" :value="m.value" class="text-xs" :title="m.title">{{ m.label }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
