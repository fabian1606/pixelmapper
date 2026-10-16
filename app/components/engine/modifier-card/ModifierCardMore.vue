<script setup lang="ts">
/**
 * Per-card blend mode under "More" (plan M5.6, M10.2): how this modifier's
 * output combines with the modifiers above it.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BlendMode } from '~/utils/engine/types';
import { BLEND_MODE_DESCRIPTIONS, BLEND_MODE_LABELS } from '~/utils/engine/blend-modes';

defineProps<{ blendMode: BlendMode }>();

const emit = defineEmits<{
  update: [mode: BlendMode];
  'dropdown-open-change': [open: boolean];
}>();

const MODES = (Object.keys(BLEND_MODE_LABELS) as BlendMode[]).map(value => ({ value, label: BLEND_MODE_LABELS[value], title: BLEND_MODE_DESCRIPTIONS[value] }));
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
