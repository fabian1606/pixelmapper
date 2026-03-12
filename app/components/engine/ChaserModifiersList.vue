<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import type { Effect, ChannelType } from '~/utils/engine/types';
import ChaserFanningControl from './ChaserFanningControl.vue';
import SpeedControl from './SpeedControl.vue';

defineProps<{
  activeModifiers: Effect[];
  activeModifier: Effect | null | undefined;
  availableChannelTypes: ChannelType[];
}>();

const emit = defineEmits<{
  (e: 'select-modifier', effect: Effect | null): void;
  (e: 'remove-modifier', effect: Effect): void;
  (e: 'toggle-target-channel', effect: Effect, type: ChannelType): void;
  (e: 'update-modifier', effect: Effect, key: string, value: any): void;
  (e: 'update-modifier-properties', effect: Effect, updates: Partial<Effect>, description: string): void;
  (e: 'reverse-direction', effect: Effect): void;
  (e: 'handle-modifier-drag-end', description: string): void;
  (e: 'add-modifier'): void;
  (e: 'dropdown-open-change', open: boolean): void;
}>();
</script>

<template>
  <div class="space-y-4">
    <div v-if="activeModifiers.length === 0" class="py-10 px-4 text-center flex flex-col items-center gap-2">
      <span class="text-sm text-foreground font-semibold">No Modifiers</span>
      <span class="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
        Modifiers allow you to apply dynamic waveforms to override or enhance underlying step values.
      </span>
    </div>

    <div 
      v-for="(modifier, i) in activeModifiers" 
      :key="i" 
      class="border rounded-lg bg-card shadow-sm overflow-hidden flex flex-col cursor-pointer transition-colors"
      :class="activeModifier === modifier ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/50'"
      @click="emit('select-modifier', modifier)"
    >
      <!-- Modifier Header with Dropdown -->
      <div class="flex items-center justify-between p-3 border-b border-border/60 bg-muted/20">
        <Select :model-value="'Sine Effect'">
          <SelectTrigger class="w-[140px] h-8 text-xs font-medium border-0 shadow-none focus:ring-0 px-2 bg-transparent hover:bg-muted/50 transition-colors">
            <SelectValue placeholder="Select Effect" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel class="text-xs text-muted-foreground">Waveforms</SelectLabel>
              <SelectItem value="Sine Effect" class="text-xs">Sine Wave</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" @click.stop="emit('remove-modifier', modifier)">
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>
      
      <div class="p-3 space-y-4">
        <!-- Channels Multi-select -->
        <div class="space-y-2">
          <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Target Channels</Label>
          <div class="flex flex-wrap gap-1.5">
            <button 
              v-for="type in availableChannelTypes" 
              :key="type"
              @click="emit('toggle-target-channel', modifier, type)"
              class="px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all"
              :class="[
                modifier.targetChannels.includes(type) 
                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20' 
                  : 'bg-transparent text-muted-foreground border-border hover:border-muted-foreground/50 hover:bg-muted/30',
                (modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1) ? 'opacity-50 cursor-not-allowed' : ''
              ]"
              :disabled="modifier.targetChannels.includes(type) && modifier.targetChannels.length <= 1"
            >
              {{ type }}
            </button>
          </div>
        </div>
        
        <div class="space-y-3 pt-3 border-t border-border/40">
          <!-- Parameters Grid -->
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div class="space-y-1.5">
              <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Strength</Label>
              <DraggableNumberInput
                :model-value="modifier.strength"
                @update:model-value="(v: number) => emit('update-modifier', modifier, 'strength', v)"
                unit="%"
                :min="0"
                :max="100"
                @change="emit('handle-modifier-drag-end', 'Update Modifier Strength')"
              />
            </div>
            <!-- Speed -->
            <div class="space-y-1.5 flex flex-col justify-start">
              <SpeedControl 
                label="Speed"
                :disable-infinite="true"
                :model-value="(modifier as any).speed" 
                @update:model-value="emit('update-modifier', modifier, 'speed', $event); emit('handle-modifier-drag-end', 'Update Modifier Speed')" 
                @dropdown-open-change="v => emit('dropdown-open-change', v)"
              />
            </div>
            <!-- Direction & Reverse Control Extracted -->
            <div class="col-span-2">
              <ChaserFanningControl
                :fanning="modifier.fanning || 0"
                :direction="modifier.direction"
                :reverse="modifier.reverse"
                @update:properties="v => emit('update-modifier-properties', modifier, v, 'Change Fanning Properties')"
                @dropdown-open="v => emit('dropdown-open-change', v)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-center pt-2">
      <Button 
        variant="outline"
        class="hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all gap-2"
        @click="emit('add-modifier')" 
      >
        <Plus class="h-4 w-4" /> Add Modifier
      </Button>
    </div>
  </div>
</template>
