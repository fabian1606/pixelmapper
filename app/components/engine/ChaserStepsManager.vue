<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import type { ChannelChaserConfig, ChannelType } from '~/utils/engine/types';
import { Trash, Trash2 } from 'lucide-vue-next';

// Layer mode: 'steps' is the default visual editing mode, 'modifiers' hides faders and shows advanced timing (effects)
const layerMode = ref<'steps'|'modifiers'>('steps');

const props = defineProps<{
  fixtures: Fixture[];
  activeTab: ChannelCategoryKey;
}>();

const emit = defineEmits<{
  (e: 'change'): void;
}>();

function tabChannelFilter(type: ChannelType, role?: string): boolean {
  const cat = CHANNEL_CATEGORIES.find(c => c.id === props.activeTab);
  if (!cat) return false;
  if (cat.id === 'intensity' && role === 'DIMMER') return true;
  if (cat.id === 'color' && role === 'COLOR') return true;
  return cat.types.includes(type);
}

const activeChaserConfig = computed<ChannelChaserConfig>(() => {
  let maxSteps = 1;
  let maxActiveStep = 0;
  let isPlaying = true;
  let stepDurationMs = 1000;
  let fadeDurationMs = 0;
  let found = false;

  for (const f of props.fixtures) {
    for (const c of f.channels) {
      if (tabChannelFilter(c.type, c.role) && c.chaserConfig) {
        if (!found) {
          isPlaying = c.chaserConfig.isPlaying;
          stepDurationMs = c.chaserConfig.stepDurationMs;
          fadeDurationMs = c.chaserConfig.fadeDurationMs;
          found = true;
        }
        if (c.chaserConfig.stepsCount > maxSteps) maxSteps = c.chaserConfig.stepsCount;
        if (c.chaserConfig.activeEditStep > maxActiveStep) maxActiveStep = c.chaserConfig.activeEditStep;
      }
    }
  }

  return {
    stepsCount: maxSteps,
    activeEditStep: Math.min(maxActiveStep, maxSteps - 1),
    isPlaying,
    stepDurationMs,
    fadeDurationMs
  };
});

function setActiveStep(index: number) {
  const target = activeChaserConfig.value;
  for (const f of props.fixtures) {
    for (const c of f.channels) {
      if (tabChannelFilter(c.type, c.role)) {
        if (!c.chaserConfig) c.chaserConfig = { ...target };
        c.chaserConfig.stepsCount = target.stepsCount;
        c.chaserConfig.activeEditStep = index;
        
        while (c.stepValues.length < target.stepsCount) {
          c.stepValues.push(c.stepValues[c.stepValues.length - 1] ?? 0);
        }
      }
    }
  }
  emit('change');
}

function removeChaser() {
  const target = activeChaserConfig.value;
  for (const fixture of props.fixtures) {
    for (const channel of fixture.channels) {
      if (tabChannelFilter(channel.type, channel.role)) {
        channel.chaserConfig = undefined;
        if (channel.stepValues.length > 1) {
          channel.stepValues = [channel.stepValues[target.activeEditStep] ?? channel.stepValues[0] ?? 0];
        }
      }
    }
  }
  emit('change');
}

function addStep() {
  const target = activeChaserConfig.value;
  const newIndex = target.stepsCount;
  
  for (const fixture of props.fixtures) {
    for (const channel of fixture.channels) {
      if (tabChannelFilter(channel.type, channel.role)) {
        if (!channel.chaserConfig) channel.chaserConfig = { ...target };
        
        channel.chaserConfig.stepsCount = newIndex + 1;
        channel.chaserConfig.activeEditStep = newIndex;
        
        while (channel.stepValues.length < newIndex) {
          channel.stepValues.push(channel.stepValues[channel.stepValues.length - 1] ?? 0);
        }
        channel.stepValues[newIndex] = channel.stepValues[target.activeEditStep] ?? channel.stepValues[channel.stepValues.length - 1] ?? 0;
      }
    }
  }
  emit('change');
}

function deleteActiveStep() {
  const target = activeChaserConfig.value;
  if (target.stepsCount <= 1) return;
  
  const toDelete = target.activeEditStep;
  for (const fixture of props.fixtures) {
    for (const channel of fixture.channels) {
      if (tabChannelFilter(channel.type, channel.role)) {
        if (!channel.chaserConfig) channel.chaserConfig = { ...target };
        
        while (channel.stepValues.length < target.stepsCount) {
          channel.stepValues.push(channel.stepValues[channel.stepValues.length - 1] ?? 0);
        }
        channel.stepValues.splice(toDelete, 1);
        
        channel.chaserConfig.stepsCount = target.stepsCount - 1;
        // Adjust the active edit step so it remains valid across the new array size
        if (toDelete === target.stepsCount - 1 && target.activeEditStep === toDelete) {
           channel.chaserConfig.activeEditStep = toDelete - 1;
        } else if (target.activeEditStep > toDelete) {
           channel.chaserConfig.activeEditStep = target.activeEditStep - 1;
        } else {
           channel.chaserConfig.activeEditStep = target.activeEditStep;
        }
      }
    }
  }
  emit('change');
}

function updateTiming(key: 'stepDurationMs' | 'fadeDurationMs', value: number) {
  const target = activeChaserConfig.value;
  for (const fixture of props.fixtures) {
    for (const channel of fixture.channels) {
      if (tabChannelFilter(channel.type, channel.role)) {
        if (!channel.chaserConfig) channel.chaserConfig = { ...target };
        channel.chaserConfig[key] = value;
      }
    }
  }
  emit('change');
}

defineExpose({
  activeChaserConfig,
  layerMode,
});
</script>

<template>
  <div class="px-4 py-3 border-b border-border space-y-4 bg-background">
    
    <!-- Layer Mode Switch (Always highest level) -->
    <div class="flex items-center justify-center p-1 bg-muted rounded-lg">
      <button 
        @click="layerMode = 'steps'"
        class="flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200"
        :class="layerMode === 'steps' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      >
        Steps
      </button>
      <button 
        @click="layerMode = 'modifiers'"
        class="flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200"
        :class="layerMode === 'modifiers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      >
        Modifiers
      </button>
    </div>

    <!-- Active Chaser Config -->
    <div v-if="activeChaserConfig" class="space-y-4">
      
      <!-- Steps Level -->
      <div v-if="layerMode === 'steps'" class="space-y-4">
        
        <!-- Timing rows -->
        <div v-if="activeChaserConfig.stepsCount > 1" class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground font-medium uppercase tracking-wider">Speed (ms)</span>
            <input type="number" :value="activeChaserConfig.stepDurationMs" @input="e => updateTiming('stepDurationMs', Number((e.target as HTMLInputElement).value))" class="w-24 h-7 text-xs bg-background border border-border rounded px-2 focus:ring-1 focus:ring-primary outline-none transition-all text-right" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground font-medium uppercase tracking-wider">Fade (ms)</span>
            <input type="number" :value="activeChaserConfig.fadeDurationMs" @input="e => updateTiming('fadeDurationMs', Number((e.target as HTMLInputElement).value))" class="w-24 h-7 text-xs bg-background border border-border rounded px-2 focus:ring-1 focus:ring-primary outline-none transition-all text-right" />
          </div>
        </div>

        <!-- Steps Row -->
        <div class="flex items-center justify-between pt-1">
          <!-- Steps Selection list -->
          <div class="flex gap-1.5 overflow-x-auto flex-1 items-center pr-4">
            <button
              v-for="stepIndex in activeChaserConfig.stepsCount"
              :key="stepIndex"
              @click="setActiveStep(stepIndex - 1)"
              class="w-10 h-8 rounded-md text-sm font-medium flex items-center justify-center transition-all shrink-0"
              :class="activeChaserConfig.activeEditStep === stepIndex - 1 ? 'bg-accent border-2 border-primary text-primary' : 'bg-muted border-2 border-transparent hover:border-border text-foreground'"
            >
              {{ stepIndex }}
            </button>
            <button
              @click="addStep"
              class="w-8 h-8 rounded-md text-sm font-medium flex items-center justify-center bg-transparent border-2 border-dashed border-border hover:bg-muted/50 text-muted-foreground shrink-0"
              title="Add Step"
            >
              +
            </button>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5 shrink-0">
            <button 
              v-if="activeChaserConfig.stepsCount > 1"
              @click="deleteActiveStep" 
              class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete Active Step"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

      <!-- Modifiers Level (Advanced) -->
      <div v-else-if="layerMode === 'modifiers'" class="py-6 text-center border-2 border-dashed border-border/50 rounded-lg">
        <span class="text-xs text-muted-foreground italic">Modifiers coming soon...</span>
      </div>
      
    </div>
  </div>
</template>
