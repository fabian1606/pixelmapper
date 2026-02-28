<script setup lang="ts">
import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import type { ChannelChaserConfig, ChannelType } from '~/utils/engine/types';

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

function togglePlay() {
  const target = activeChaserConfig.value;
  const targetState = !target.isPlaying;
  for (const fixture of props.fixtures) {
    for (const channel of fixture.channels) {
      if (tabChannelFilter(channel.type, channel.role)) {
        if (!channel.chaserConfig) channel.chaserConfig = { ...target };
        channel.chaserConfig.isPlaying = targetState;
      }
    }
  }
  emit('change');
}

defineExpose({
  activeChaserConfig,
});
</script>

<template>
  <div>
    <!-- Chaser Steps Manager -->
    <div v-if="activeChaserConfig" class="px-4 py-3 border-b border-border space-y-3 bg-muted/10 relative group">
      <button @click="removeChaser" class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity" title="Remove steps">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-4">Steps</span>
        
        <div class="flex gap-1 overflow-x-auto flex-1 pb-1">
          <button
            v-for="stepIndex in activeChaserConfig.stepsCount"
            :key="stepIndex"
            @click="setActiveStep(stepIndex - 1)"
            class="w-8 h-6 rounded text-xs font-mono flex items-center justify-center transition-colors shrink-0"
            :class="activeChaserConfig.activeEditStep === stepIndex - 1 ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-foreground'"
          >
            {{ stepIndex }}
          </button>
          <button
            @click="addStep"
            class="w-6 h-6 rounded text-xs font-mono flex items-center justify-center bg-transparent border border-dashed border-border hover:bg-muted/50 text-muted-foreground shrink-0"
          >
            +
          </button>
        </div>
      </div>

      <!-- Chaser config options (only visible if > 1 step) -->
      <div v-if="activeChaserConfig.stepsCount > 1" class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-muted-foreground uppercase flex-1">Speed (ms)</span>
          <input type="number" :value="activeChaserConfig.stepDurationMs" @input="e => updateTiming('stepDurationMs', Number((e.target as HTMLInputElement).value))" class="w-16 h-6 text-xs bg-background border border-border rounded px-1 text-right" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-muted-foreground uppercase flex-1">Fade (ms)</span>
          <input type="number" :value="activeChaserConfig.fadeDurationMs" @input="e => updateTiming('fadeDurationMs', Number((e.target as HTMLInputElement).value))" class="w-16 h-6 text-xs bg-background border border-border rounded px-1 text-right" />
        </div>
        <div class="flex justify-between items-center mt-1">
          <button @click="togglePlay" class="text-[10px] font-medium px-2 py-0.5 rounded bg-muted hover:bg-muted/80">
            {{ activeChaserConfig.isPlaying ? 'Pause' : 'Play' }}
          </button>
          <button @click="deleteActiveStep" class="text-[10px] text-destructive hover:underline">
            Delete Step
          </button>
        </div>
      </div>
    </div>
    
    <!-- (Removed manual 'create chaser' button because we implicitly have 1 step minimum!) -->
  </div>
</template>
