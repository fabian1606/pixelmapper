<script setup lang="ts">
import { computed, ref, inject } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import type { ChannelChaserConfig, ChannelType, Effect } from '~/utils/engine/types';
import type { EffectEngine } from '~/utils/engine/engine';
import { SineEffect } from '~/utils/engine/effects/sine-effect';
import { Trash, Trash2, Plus } from 'lucide-vue-next';
import { findRichestFixture, syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';

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
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'steps');
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
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'steps');
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
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'steps');
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
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'steps');
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
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'steps');
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

const effectEngine = inject<EffectEngine>('effectEngine');

const availableChannelTypes = computed<ChannelType[]>(() => {
  const cat = CHANNEL_CATEGORIES.find(c => c.id === props.activeTab);
  if (!cat) return [];
  const types = new Set<ChannelType>();
  for (const f of props.fixtures) {
    for (const c of f.channels) {
      if (tabChannelFilter(c.type, c.role)) types.add(c.type);
    }
  }
  return Array.from(types);
});

function hasMatchingChannel(effect: Effect) {
  if (!effect.targetChannels) return false;
  return effect.targetChannels.some(type => availableChannelTypes.value.includes(type));
}

const richestFixture = computed(() => {
  return findRichestFixture(props.fixtures, tabChannelFilter, effectEngine);
});

const activeModifiers = computed(() => {
  if (!effectEngine || !richestFixture.value) return [];
  return effectEngine.effects.filter(effect => {
    // Matches the richest fixture
    const matchesFixture = effect.targetFixtureIds?.includes(richestFixture.value!.id);
    
    // Matches channel category
    const matchesChannels = hasMatchingChannel(effect);

    return matchesFixture && matchesChannels;
  });
});

function addSineModifier() {
  if (!effectEngine) return;
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'modifiers');
  const effect = new SineEffect();
  effect.targetChannels = [...availableChannelTypes.value]; // default to all relevant channels
  effect.targetFixtureIds = props.fixtures.map(f => f.id);
  effect.strength = 100;
  effect.speed = 0.005;
  effect.fanning = 0.5;
  effect.direction = 'FORWARD';
  effectEngine.addEffect(effect);
  emit('change');
}

function cloneModifier(effect: Effect): Effect {
  if (effect instanceof SineEffect) {
    const clone = new SineEffect();
    clone.targetChannels = [...(effect.targetChannels || [])];
    clone.targetFixtureIds = effect.targetFixtureIds ? [...effect.targetFixtureIds] : undefined;
    clone.direction = effect.direction;
    clone.strength = effect.strength;
    clone.fanning = effect.fanning;
    clone.speed = effect.speed;
    (clone as any).timePhase = (effect as any).timePhase;
    return clone;
  }
  return effect;
}

function resolveStaleEffect(effect: Effect, selectedIds: (string|number)[]): Effect {
  if (effect.targetFixtureIds && !effect.targetFixtureIds.some(id => selectedIds.includes(id))) {
      const newEff = effectEngine?.effects.find(e => 
         e.targetFixtureIds && 
         e.targetFixtureIds.some(id => selectedIds.includes(id)) && 
         e instanceof effect.constructor
      );
      if (newEff) return newEff;
  }
  return effect;
}

function getSafeEffectToMutate(effect: Effect, selectedIds: (string|number)[]): Effect {
  const eff = resolveStaleEffect(effect, selectedIds);
  
  if (eff.targetFixtureIds) {
    const unselectedTargets = eff.targetFixtureIds.filter(id => !selectedIds.includes(id));
    if (unselectedTargets.length > 0) {
      // Split!
      eff.targetFixtureIds = unselectedTargets;
      const clone = cloneModifier(eff);
      clone.targetFixtureIds = [...selectedIds];
      effectEngine!.addEffect(clone);
      return clone;
    } else {
      // Mutate in place & expand to all selected
      for (const id of selectedIds) {
        if (!eff.targetFixtureIds.includes(id)) {
          eff.targetFixtureIds.push(id);
        }
      }
    }
  }
  return eff;
}

function updateModifier(effect: Effect, key: string, value: any) {
  if (!effectEngine) return;
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'modifiers');
  const selectedIds = props.fixtures.map(f => f.id);
  const safeEff = getSafeEffectToMutate(effect, selectedIds);
  (safeEff as any)[key] = value;
  emit('change');
}

function toggleTargetChannel(effect: Effect, type: ChannelType) {
  if (!effectEngine) return;
  const selectedIds = props.fixtures.map(f => f.id);
  
  // Prevent deselecting the last channel to avoid orphan effects
  if (effect.targetChannels?.includes(type) && effect.targetChannels.length <= 1) {
    return;
  }
  
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'modifiers');
  const safeEff = getSafeEffectToMutate(effect, selectedIds);
  
  const idx = safeEff.targetChannels.indexOf(type);
  if (idx >= 0) {
    safeEff.targetChannels.splice(idx, 1);
  } else {
    safeEff.targetChannels.push(type);
  }
  emit('change');
}

function removeModifier(effect: Effect) {
  if (!effectEngine) return;
  syncCategoryBeforeEdit(props.fixtures, tabChannelFilter, effectEngine, 'modifiers');
  const selectedIds = props.fixtures.map(f => f.id);
  
  const eff = resolveStaleEffect(effect, selectedIds);
  
  if (eff.targetFixtureIds) {
    eff.targetFixtureIds = eff.targetFixtureIds.filter(id => !selectedIds.includes(id));
    
    if (eff.targetFixtureIds.length === 0) {
      const idx = effectEngine.effects.indexOf(eff);
      if (idx >= 0) effectEngine.effects.splice(idx, 1);
    }
  } else {
    const idx = effectEngine.effects.indexOf(eff);
    if (idx >= 0) effectEngine.effects.splice(idx, 1);
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
      <div v-else-if="layerMode === 'modifiers'" class="space-y-4">
        <div v-if="activeModifiers.length === 0" class="py-10 px-4 text-center flex flex-col items-center gap-2">
          <span class="text-sm text-foreground font-semibold">No Modifiers</span>
          <span class="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
            Modifiers allow you to apply dynamic waveforms to override or enhance underlying step values.
          </span>
        </div>

        <div v-for="(modifier, i) in activeModifiers" :key="i" class="border border-border/60 rounded-lg bg-card shadow-sm overflow-hidden flex flex-col">
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

            <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" @click="removeModifier(modifier)">
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
                  @click="toggleTargetChannel(modifier, type)"
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
                <!-- Strength -->
                <div class="space-y-1.5">
                  <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Strength</Label>
                  <Input type="number" :model-value="modifier.strength" @input="e => updateModifier(modifier, 'strength', Number((e.target as HTMLInputElement).value))" class="h-8 text-xs font-mono" />
                </div>
                <!-- Speed -->
                <div class="space-y-1.5">
                  <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Speed</Label>
                  <Input type="number" step="0.001" :model-value="(modifier as any).speed" @input="e => updateModifier(modifier, 'speed', Number((e.target as HTMLInputElement).value))" class="h-8 text-xs font-mono" />
                </div>
                <!-- Fanning -->
                <div class="space-y-1.5">
                  <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Fanning</Label>
                  <Input type="number" step="0.1" :model-value="modifier.fanning" @input="e => updateModifier(modifier, 'fanning', Number((e.target as HTMLInputElement).value))" class="h-8 text-xs font-mono" />
                </div>
                <!-- Direction -->
                <div class="space-y-1.5">
                  <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Direction</Label>
                  <Select :model-value="modifier.direction" @update:model-value="val => updateModifier(modifier, 'direction', val)">
                    <SelectTrigger class="h-8 text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel class="text-xs text-muted-foreground">Index Based</SelectLabel>
                        <SelectItem value="FORWARD" class="text-xs">Forward</SelectItem>
                        <SelectItem value="BACKWARD" class="text-xs">Backward</SelectItem>
                        <SelectItem value="CENTER_OUT" class="text-xs">Center Out</SelectItem>
                        <SelectItem value="OUTSIDE_IN" class="text-xs">Outside In</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel class="text-xs text-muted-foreground">Spatial (2D)</SelectLabel>
                        <SelectItem value="SPATIAL_X" class="text-xs">Left to Right</SelectItem>
                        <SelectItem value="SPATIAL_Y" class="text-xs">Top to Bottom</SelectItem>
                        <SelectItem value="SPATIAL_RADIAL" class="text-xs">Radial</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-center pt-2">
          <Button 
            variant="outline"
            class="hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all gap-2"
            @click="addSineModifier" 
          >
            <Plus class="h-4 w-4" /> Add Modifier
          </Button>
        </div>
      </div>
      
    </div>
  </div>
</template>
