<script setup lang="ts">
import { computed } from 'vue';
import { Timer, Activity, Infinity as InfinityIcon, ChevronDown, FastForward } from 'lucide-vue-next';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { SpeedConfig, SpeedMode } from '~/utils/engine/types';

const props = defineProps<{
  modelValue: SpeedConfig;
  label?: string;
  disableInfinite?: boolean;
  disableOffset?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: SpeedConfig): void;
  (e: 'dropdown-open-change', open: boolean): void;
}>();

const AVAILABLE_MODES: SpeedMode[] = props.disableInfinite 
  ? ['time', 'beat']
  : ['time', 'beat', 'infinite'];

const BEAT_OPTIONS = [
  { label: '1/16', value: 0.0625 },
  { label: '1/8', value: 0.125 },
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '4', value: 4 },
  { label: '8', value: 8 },
];

const OFFSET_OPTIONS = [
  { label: '0', value: 0 },
  ...BEAT_OPTIONS
];

function cycleMode() {
  const currentIndex = AVAILABLE_MODES.indexOf(props.modelValue.mode);
  const nextMode = AVAILABLE_MODES[(currentIndex + 1) % AVAILABLE_MODES.length] || 'time';
  
  emit('update:modelValue', {
    ...props.modelValue,
    mode: nextMode
  });
}

function updateTimeMs(ms: number) {
  emit('update:modelValue', {
    ...props.modelValue,
    timeMs: Math.max(0, ms)
  });
}

function updateBeatValue(beat: number) {
  emit('update:modelValue', {
    ...props.modelValue,
    beatValue: beat
  });
}

function updateBeatOffset(offset: number) {
  emit('update:modelValue', {
    ...props.modelValue,
    beatOffset: offset
  });
}

const ActiveIcon = computed(() => {
  switch (props.modelValue.mode) {
    case 'time': return Timer;
    case 'beat': return Activity;
    case 'infinite': return InfinityIcon;
    default: return Timer;
  }
});
</script>

<template>
  <div class="flex flex-col gap-1.5 w-full">
    <div v-if="label" class="flex justify-between items-center h-4">
      <Label class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">{{ label }}</Label>
    </div>
    
    <div class="flex items-center gap-1">
      <button
        @click="cycleMode"
        class="flex-shrink-0 h-8 w-8 rounded-md border border-input bg-muted/50 hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-all shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
        :title="`Mode: ${modelValue.mode}`"
      >
        <component :is="ActiveIcon" class="w-4 h-4" />
      </button>

      <div class="flex-1 relative h-8" v-if="modelValue.mode === 'time'">
        <input 
          type="number" 
          :value="modelValue.timeMs" 
          @input="e => updateTimeMs(Number((e.target as HTMLInputElement).value))" 
          class="w-full h-full text-xs bg-background border border-input rounded-md pl-2 pr-6 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] text-right font-mono shadow-xs" 
        />
        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none select-none">ms</span>
      </div>

      <div class="flex-1 h-8" v-else-if="modelValue.mode === 'beat'">
         <!-- Custom select for beats using Shadcn Select to match styling -->
         <Select 
          :model-value="modelValue.beatValue.toString()"
          @update:model-value="v => updateBeatValue(Number(v))"
          @update:open="v => emit('dropdown-open-change', v)"
         >
           <SelectTrigger class="w-full !h-8 !min-h-8 py-0 text-xs bg-background border border-input shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] px-2 font-mono">
             <SelectValue />
           </SelectTrigger>
           <SelectContent>
             <SelectItem v-for="opt in BEAT_OPTIONS" :key="opt.value" :value="opt.value.toString()">
               {{ opt.label }}
             </SelectItem>
           </SelectContent>
         </Select>
      </div>
      
      <div v-else-if="modelValue.mode === 'infinite'" class="flex-1 h-8 flex items-center justify-center bg-muted/30 border border-input border-dashed rounded-md text-xs text-muted-foreground select-none shadow-xs">
        Disabled
      </div>
    </div>

    <div v-if="modelValue.mode === 'beat' && !disableOffset" class="flex items-center gap-1 mt-0.5">
      <div
        class="flex-shrink-0 h-8 w-8 flex items-center justify-center text-muted-foreground"
        title="Phase Offset (Beats)"
      >
        <FastForward class="w-3.5 h-3.5" />
      </div>
      <div class="flex-1 h-8 flex items-center gap-2">
        <div class="flex-1 h-7">
           <Select 
            :model-value="(modelValue.beatOffset || 0).toString()"
            @update:model-value="v => updateBeatOffset(Number(v))"
            @update:open="v => emit('dropdown-open-change', v)"
           >
             <SelectTrigger class="w-full !h-8 !min-h-8 py-0 text-xs bg-background border border-input shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] px-2 font-mono">
               <SelectValue />  
             </SelectTrigger>
             <SelectContent>
               <SelectItem v-for="opt in OFFSET_OPTIONS" :key="opt.value" :value="opt.value.toString()">
                 {{ opt.value === 0 ? '0' : `+${opt.label}` }}
               </SelectItem>
             </SelectContent>
           </Select>
        </div>
      </div>
    </div>
  </div>
</template>
