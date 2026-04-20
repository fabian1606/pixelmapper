<script setup lang="ts">
import { Plus, Trash2, ChevronDown, Star } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { Effect, ChannelType, WaveformShape, WaveformShapeParams, NoiseParams, SequencerParams } from '~/utils/engine/types';
import type { PresetModifierSnapshot } from '~/utils/engine/preset-types';
import type { PinnedModifier } from '~/stores/pinned-modifiers-store';
import ChaserFanningControl from './ChaserFanningControl.vue';
import SpeedControl from './SpeedControl.vue';
import WaveformEditor from './WaveformEditor.vue';
import NoiseEditor from './NoiseEditor.vue';
import SequencerEditor from './SequencerEditor.vue';

defineProps<{
  activeModifiers: Effect[];
  activeModifier: Effect | null | undefined;
  availableChannelTypes: ChannelType[];
  pinnedModifiers: PinnedModifier[];
  pinnedEffectIds: Set<string>;
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
  (e: 'add-noise-modifier'): void;
  (e: 'add-sequencer-modifier'): void;
  (e: 'add-pinned-modifier', snapshot: PresetModifierSnapshot): void;
  (e: 'pin-modifier', effect: Effect): void;
  (e: 'switch-modifier-type', effect: Effect, type: 'Waveform' | 'Noise' | 'Sequencer'): void;
  (e: 'dropdown-open-change', open: boolean): void;
}>();

function isNoiseModifier(modifier: Effect): boolean {
  return 'noiseParams' in modifier && !!(modifier as any).noiseParams;
}

function isSequencerModifier(modifier: Effect): boolean {
  return 'sequencerParams' in modifier && !!(modifier as any).sequencerParams;
}

function waveformShape(modifier: Effect): WaveformShape {
  return (modifier as any).waveformShape ?? 'sine';
}

function waveformParams(modifier: Effect): WaveformShapeParams {
  return (modifier as any).waveformParams ?? { param: 0.5, start: 0, end: 1 };
}

function noiseParams(modifier: Effect): NoiseParams {
  return (modifier as any).noiseParams ?? { noiseType: 'white', scale: 1, channelMode: 'linked', colorVariation: 0, fade: 0, threshold: 0 };
}

function sequencerParams(modifier: Effect): SequencerParams {
  return (modifier as any).sequencerParams ?? { patternType: 'split', originX: 0.5, originY: 0.5, angle: 0, scale: 0.1, count: 4, density: 0.5, invert: false };
}

function modifierTypeName(modifier: Effect): string {
  if (isSequencerModifier(modifier)) return 'Sequencer';
  if (isNoiseModifier(modifier)) return 'Noise';
  return 'Waveform';
}
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
      <!-- Modifier Header -->
      <div class="flex items-center justify-between p-3 border-b border-border/60 bg-muted/20">
        <Select
          :model-value="modifierTypeName(modifier)"
          @update:model-value="(v: any) => {
            const next = v as 'Waveform' | 'Noise' | 'Sequencer';
            if (next !== modifierTypeName(modifier)) emit('switch-modifier-type', modifier, next);
          }"
        >
          <SelectTrigger class="w-[140px] h-8 text-xs font-medium border-0 shadow-none focus:ring-0 px-2 bg-transparent hover:bg-muted/50 transition-colors" @click.stop>
            <SelectValue placeholder="Select Effect" />
          </SelectTrigger>
          <SelectContent @pointerdown.stop>
            <SelectItem value="Waveform" class="text-xs">Waveform</SelectItem>
            <SelectItem value="Noise" class="text-xs">Noise</SelectItem>
            <SelectItem value="Sequencer" class="text-xs">Sequencer</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-yellow-400" @click.stop="emit('pin-modifier', modifier)">
          <Star class="h-4 w-4" :class="pinnedEffectIds.has(modifier.id) ? 'fill-yellow-400 text-yellow-400' : ''" />
        </Button>
        <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" @click.stop="emit('remove-modifier', modifier)">
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>

      <div class="p-3 space-y-4">
        <!-- Target Channels -->
        <div class="space-y-2">
          <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Target Channels</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="type in availableChannelTypes"
              :key="type"
              @click.stop="emit('toggle-target-channel', modifier, type)"
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

        <!-- Waveform editor -->
        <template v-if="!isNoiseModifier(modifier) && !isSequencerModifier(modifier)">
          <div class="pt-1 border-t border-border/40">
            <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Waveform</Label>
          </div>
          <WaveformEditor
            :shape="waveformShape(modifier)"
            :params="waveformParams(modifier)"
            :strength="modifier.strength"
            :speed="(modifier as any).speed"
            @update:shape="(s: WaveformShape) => { emit('update-modifier', modifier, 'waveformShape', s); emit('handle-modifier-drag-end', 'Update Waveform Shape') }"
            @update:params="(p: WaveformShapeParams) => emit('update-modifier', modifier, 'waveformParams', p)"
            @update:strength="(v: number) => emit('update-modifier', modifier, 'strength', v)"
            @change-end="emit('handle-modifier-drag-end', 'Update Waveform')"
            @click.stop
          />
        </template>

        <!-- Noise editor -->
        <template v-else-if="isNoiseModifier(modifier)">
          <div class="pt-1 border-t border-border/40">
            <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Noise</Label>
          </div>
          <NoiseEditor
            :noise-params="noiseParams(modifier)"
            :speed="(modifier as any).speed"
            :strength="modifier.strength"
            @update:noise-params="(p: NoiseParams) => emit('update-modifier', modifier, 'noiseParams', p)"
            @update:strength="(v: number) => emit('update-modifier', modifier, 'strength', v)"
            @change-end="emit('handle-modifier-drag-end', 'Update Noise')"
            @click.stop
          />
        </template>

        <!-- Sequencer editor -->
        <template v-else-if="isSequencerModifier(modifier)">
          <div class="pt-1 border-t border-border/40">
            <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Sequencer</Label>
          </div>
          <SequencerEditor
            :sequencer-params="sequencerParams(modifier)"
            :strength="modifier.strength"
            @update:sequencer-params="(p: SequencerParams) => emit('update-modifier', modifier, 'sequencerParams', p)"
            @update:strength="(v: number) => emit('update-modifier', modifier, 'strength', v)"
            @change-end="emit('handle-modifier-drag-end', 'Update Sequencer')"
            @click.stop
          />
        </template>

        <div class="space-y-3 pt-3 border-t border-border/40">
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div v-if="!isNoiseModifier(modifier) && !isSequencerModifier(modifier)" class="space-y-1.5">
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
            <div class="space-y-1.5 flex flex-col justify-start">
              <SpeedControl
                label="Speed"
                :disable-infinite="true"
                :model-value="(modifier as any).speed"
                @update:model-value="emit('update-modifier', modifier, 'speed', $event); emit('handle-modifier-drag-end', 'Update Modifier Speed')"
                @dropdown-open-change="v => emit('dropdown-open-change', v)"
              />
            </div>
            <!-- Fanning only for waveform modifiers -->
            <div v-if="!isNoiseModifier(modifier) && !isSequencerModifier(modifier)" class="col-span-2">
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

    <!-- Add Modifier dropdown -->
    <div class="flex justify-center pt-2">
      <DropdownMenu @update:open="v => emit('dropdown-open-change', v)">
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            class="hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all gap-2"
          >
            <Plus class="h-4 w-4" /> Add Modifier <ChevronDown class="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem @click="emit('add-modifier')">Waveform</DropdownMenuItem>
          <DropdownMenuItem @click="emit('add-noise-modifier')">Noise</DropdownMenuItem>
          <DropdownMenuItem @click="emit('add-sequencer-modifier')">Sequencer</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger class="gap-2">
              <Star class="h-4 w-4" /> Pinned
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem v-if="pinnedModifiers.length === 0" disabled class="text-muted-foreground">No pinned modifiers</DropdownMenuItem>
              <DropdownMenuItem v-for="p in pinnedModifiers" :key="p.id" @click="emit('add-pinned-modifier', p.snapshot)">
                {{ p.name }}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
