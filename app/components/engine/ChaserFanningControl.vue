<script setup lang="ts">
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ArrowDownUp } from 'lucide-vue-next';

import type { EffectDirection } from '~/utils/engine/types';

const props = defineProps<{
  fanning: number;
  direction?: EffectDirection;
  reverse?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:properties', updates: { fanning?: number; direction?: EffectDirection; reverse?: boolean }): void;
  (e: 'dropdown-open', value: boolean): void;
}>();

function onDirectionChange(val: any) {
  emit('dropdown-open', false);
  if (val === 'NONE') {
    emit('update:properties', { fanning: 0 });
  } else if (typeof val === 'string') {
    emit('update:properties', { 
      fanning: props.fanning === 0 ? 0.1 : props.fanning, 
      direction: val as EffectDirection 
    });
  }
}
</script>

<template>
  <div class="flex items-end gap-2 w-full">
    <div class="flex-1 space-y-1.5">
      <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Fanning / Direction</Label>
      <Select 
        :model-value="fanning === 0 ? 'NONE' : direction" 
        @update:model-value="onDirectionChange"
        @update:open="val => emit('dropdown-open', val)"
      >
        <SelectTrigger class="h-8 text-xs font-medium">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="NONE" class="text-xs">None (all in sync)</SelectItem>
            <SelectLabel class="text-xs text-muted-foreground mt-2">Spatial (2D)</SelectLabel>
            <SelectItem value="LINEAR" class="text-xs">Linear</SelectItem>
            <SelectItem value="RADIAL" class="text-xs">Radial</SelectItem>
            <SelectItem value="SYMMETRICAL" class="text-xs">Symmetrical</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
    
    <Button 
      v-if="fanning !== 0"
      variant="outline" 
      size="icon" 
      class="h-8 w-8 transition-colors shrink-0"
      :class="reverse ? 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/20' : 'text-muted-foreground hover:text-foreground'"
      @click.stop="emit('update:properties', { reverse: !reverse })" 
      title="Reverse direction"
    >
      <ArrowDownUp class="h-4 w-4" />
    </Button>
  </div>
</template>
