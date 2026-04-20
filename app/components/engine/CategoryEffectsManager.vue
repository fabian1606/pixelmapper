<script setup lang="ts">
import { ref, inject, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect } from '~/utils/engine/types';
import { useSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';

import { ScrollArea } from '@/components/ui/scroll-area';
import ChaserStepsList from './ChaserStepsList.vue';
import ChaserModifiersList from './ChaserModifiersList.vue';

import { useChaserHistory } from './composables/use-chaser-history';
import { useChaserSteps } from './composables/use-chaser-steps';
import { useChaserModifiers } from './composables/use-chaser-modifiers';

// Layer mode: 'steps' is the default visual editing mode, 'modifiers' hides faders and shows advanced timing (effects)
const layerMode = ref<'steps'|'modifiers'>('steps');

const props = defineProps<{
  fixtures: Fixture[];
  activeTab: ChannelCategoryKey;
}>();

const emit = defineEmits<{
  (e: 'change'): void;
}>();

const effectEngine = inject<EffectEngine>('effectEngine');

// Sidebar close lock to prevent the sidebar from auto-closing when clicking outside dropdowns
const { lock, unlock } = useSidebarLock();
function handleDropdownOpenChange(open: boolean) {
  if (open) lock();
  else unlock();
}

const historyTools = useChaserHistory(props, effectEngine);

const { 
  activeChaserConfig, 
  tabChannelFilter, 
  setActiveStep, 
  addStep, 
  deleteActiveStep, 
  updateTiming, 
  removeChaser 
} = useChaserSteps(props, effectEngine, historyTools, () => emit('change'));

const {
  activeModifiers,
  availableChannelTypes,
  addWaveformModifier,
  addNoiseModifier,
  addSequencerModifier,
  switchModifierType,
  handleModifierDragEnd,
  updateModifier,
  updateModifierProperties,
  toggleTargetChannel,
  removeModifier,
  selectModifier,
  reverseDirection
} = useChaserModifiers(props, effectEngine, historyTools, tabChannelFilter, () => emit('change'));

// Clear the spatial handle whenever the user leaves the Modifiers tab,
// and auto-select the first modifier if available when entering the Modifiers tab
watch(layerMode, (mode) => {
  if (mode === 'steps' && effectEngine) {
    effectEngine.activeModifier.value = null;
  } else if (mode === 'modifiers' && effectEngine && effectEngine.effects.length > 0) {
    if (!effectEngine.activeModifier.value || !effectEngine.effects.includes(effectEngine.activeModifier.value as Effect)) {
      effectEngine.activeModifier.value = effectEngine.effects[0] || null;
    }
  }
});

// Clean up or auto-select a valid modifier if the selection changes underneath the user
watch(activeModifiers, (modifiers) => {
  if (layerMode.value === 'modifiers' && effectEngine) {
    const currentActive = effectEngine.activeModifier.value;
    if (currentActive && !modifiers.includes(currentActive)) {
      effectEngine.activeModifier.value = modifiers.length > 0 ? (modifiers[0] as Effect) : null;
    }
  }
});

function openModifier(effectId?: string) {
  layerMode.value = 'modifiers';
  if (effectId && effectEngine) {
    const eff = effectEngine.effects.find(e => e.id === effectId);
    if (eff) {
      effectEngine.activeModifier.value = eff;
    }
  }
}

function openSteps() {
  layerMode.value = 'steps';
}

defineExpose({
  activeChaserConfig,
  layerMode,
  openModifier,
  openSteps,
});
</script>

<template>
  <div class="flex flex-col border-b border-border bg-background" :class="layerMode === 'modifiers' ? 'flex-1 min-h-0' : ''">

    <!-- Layer Mode Switch (Always highest level) -->
    <div class="px-4 pt-3 pb-3">
      <div class="flex items-center justify-center p-1 bg-muted rounded-md border border-border">
        <button
          @click="layerMode = 'steps'"
          class="flex-1 text-xs font-semibold py-1.5 rounded-sm transition-all duration-200"
          :class="layerMode === 'steps' ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'"
        >
          Steps
        </button>
        <button
          @click="layerMode = 'modifiers'"
          class="flex-1 text-xs font-semibold py-1.5 rounded-sm transition-all duration-200"
          :class="layerMode === 'modifiers' ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'"
        >
          Modifiers
        </button>
      </div>
    </div>

    <!-- Active Chaser Config -->
    <template v-if="activeChaserConfig">

      <!-- Steps Level -->
      <div v-if="layerMode === 'steps'" class="px-4 pb-3 space-y-4">
        <ChaserStepsList
          :active-chaser-config="activeChaserConfig"
          @update-timing="updateTiming"
          @set-active-step="setActiveStep"
          @add-step="addStep"
          @delete-active-step="deleteActiveStep"
          @dropdown-open-change="handleDropdownOpenChange"
        />
      </div>

      <!-- Modifiers Level (scrollable) -->
      <ScrollArea v-else-if="layerMode === 'modifiers'" class="flex-1 min-h-0">
        <div class="px-4 pb-3 space-y-4">
          <ChaserModifiersList
            :active-modifiers="activeModifiers"
            :active-modifier="effectEngine?.activeModifier?.value ?? null"
            :available-channel-types="availableChannelTypes"
            @select-modifier="selectModifier"
            @remove-modifier="removeModifier"
            @toggle-target-channel="toggleTargetChannel"
            @update-modifier="updateModifier"
            @update-modifier-properties="updateModifierProperties"
            @reverse-direction="reverseDirection"
            @handle-modifier-drag-end="handleModifierDragEnd"
            @add-modifier="addWaveformModifier"
            @add-noise-modifier="addNoiseModifier"
            @add-sequencer-modifier="addSequencerModifier"
            @switch-modifier-type="switchModifierType"
            @dropdown-open-change="handleDropdownOpenChange"
          />
        </div>
      </ScrollArea>

    </template>
  </div>
</template>
