<script setup lang="ts">
import { ref, inject, watch } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect } from '~/utils/engine/types';
import { useSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';

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
  addSineModifier,
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
    effectEngine.activeModifier.value = effectEngine.effects[0] || null;
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

defineExpose({
  activeChaserConfig,
  layerMode,
});
</script>

<template>
  <div class="px-4 py-3 border-b border-border space-y-4 bg-background">
    
    <!-- Layer Mode Switch (Always highest level) -->
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

    <!-- Active Chaser Config -->
    <div v-if="activeChaserConfig" class="space-y-4">
      
      <!-- Steps Level -->
      <div v-if="layerMode === 'steps'" class="space-y-4">
        <ChaserStepsList
          :active-chaser-config="activeChaserConfig"
          @update-timing="updateTiming"
          @set-active-step="setActiveStep"
          @add-step="addStep"
          @delete-active-step="deleteActiveStep"
          @dropdown-open-change="handleDropdownOpenChange"
        />
      </div>

      <!-- Modifiers Level (Advanced) -->
      <div v-else-if="layerMode === 'modifiers'" class="space-y-4">
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
          @add-modifier="addSineModifier"
          @dropdown-open-change="handleDropdownOpenChange"
        />
      </div>
      
    </div>
  </div>
</template>
