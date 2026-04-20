<script setup lang="ts">
import { ref, inject, watch, computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import type { EffectEngine } from '~/utils/engine/engine';
import type { Effect } from '~/utils/engine/types';
import type { PresetModifierSnapshot } from '~/utils/engine/preset-types';
import { useSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';
import { usePinnedModifiersStore } from '~/stores/pinned-modifiers-store';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { BlendMode } from '~/utils/engine/types';

const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  add: 'Add', override: 'Override', multiply: 'Mask', max: 'Brighten', min: 'Darken',
};

const BLEND_MODE_DESCRIPTIONS: Record<BlendMode, string> = {
  add: 'Offsets from all modifiers are summed together. A waveform with strength 50 and another with strength 30 produce a combined swing of ±80 around the base.',
  override: 'Each modifier fully replaces whatever came before it. Only the last modifier in the list determines the final value — earlier ones have no effect.',
  multiply: 'The accumulated result is multiplied by each modifier\'s output. Best with a Sequencer: OFF fixtures are dimmed toward black while ON fixtures keep the previous modifiers intact.',
  max: 'The brighter value wins at each step. Useful for combining two waveforms that should boost brightness without clipping — each one can only add, never subtract.',
  min: 'The darker value wins at each step. Use to cut brightness or create shadow zones — a waveform can only reduce the result, never push it higher.',
};
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
  addPinnedModifier,
  switchModifierType,
  handleModifierDragEnd,
  updateModifier,
  updateModifierProperties,
  toggleTargetChannel,
  removeModifier,
  selectModifier,
  reverseDirection
} = useChaserModifiers(props, effectEngine, historyTools, tabChannelFilter, () => emit('change'));

const pinnedStore = usePinnedModifiersStore();
const pinnedEffectIds = computed(() => new Set(pinnedStore.pinnedModifiers.map(p => p.effectId)));

function handlePinModifier(effect: Effect) {
  if (pinnedStore.isPinned(effect.id)) {
    pinnedStore.unpinModifier(effect.id);
  } else {
    pinnedStore.pinModifier(effect);
  }
}

function handleAddPinnedModifier(snapshot: PresetModifierSnapshot) {
  addPinnedModifier(snapshot);
}

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
          <!-- Blend mode selector — only when 2+ modifiers active -->
          <div v-if="activeModifiers.length >= 2" class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground w-20 shrink-0">Stacking</span>
            <Select
              :model-value="effectEngine?.stackBlendMode?.value ?? 'add'"
              @update:model-value="(v: any) => { if (effectEngine) effectEngine.stackBlendMode.value = v as BlendMode }"
            >
              <SelectTrigger class="h-7 text-xs flex-1" @click.stop @pointerdown.stop>
                <span>{{ BLEND_MODE_LABELS[effectEngine?.stackBlendMode?.value ?? 'add'] }}</span>
              </SelectTrigger>
              <SelectContent @pointerdown.stop>
                <TooltipProvider :delay-duration="400">
                  <Tooltip v-for="(label, mode) in BLEND_MODE_LABELS" :key="mode">
                    <TooltipTrigger as-child>
                      <SelectItem :value="mode" class="text-xs">{{ label }}</SelectItem>
                    </TooltipTrigger>
                    <TooltipContent side="left" class="max-w-[220px] text-xs bg-popover text-popover-foreground border border-border">
                      {{ BLEND_MODE_DESCRIPTIONS[mode as BlendMode] }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SelectContent>
            </Select>
          </div>
          <ChaserModifiersList
            :active-modifiers="activeModifiers"
            :active-modifier="effectEngine?.activeModifier?.value ?? null"
            :available-channel-types="availableChannelTypes"
            :pinned-modifiers="pinnedStore.pinnedModifiers"
            :pinned-effect-ids="pinnedEffectIds"
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
            @add-pinned-modifier="handleAddPinnedModifier"
            @pin-modifier="handlePinModifier"
            @switch-modifier-type="switchModifierType"
            @dropdown-open-change="handleDropdownOpenChange"
          />
        </div>
      </ScrollArea>

    </template>
  </div>
</template>
