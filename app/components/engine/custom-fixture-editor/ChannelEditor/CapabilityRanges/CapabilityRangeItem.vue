<script setup lang="ts">
import { computed } from 'vue';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { X, Disc3 } from 'lucide-vue-next';
import {
  CHANNEL_CAPABILITY_META,
  WHEEL_RANGE_TYPES,
  type CapabilityRange,
  type WheelDraft,
} from '~/utils/engine/custom-fixture-types';
import type { ChannelType } from '~/utils/engine/types';
import CapabilityFieldGroup from './CapabilityFieldGroup.vue';

const props = defineProps<{
  range: CapabilityRange;
  ri: number;
  isSingleFullRange: boolean;
  totalCaps: number;
  prevMax?: number;
  nextMax?: number;
  capabilityGroups: Record<string, { type: ChannelType; label: string }[]>;
  selectedChannelType: ChannelType;
  wheel?: WheelDraft | null;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
  (e: 'maxChange', val: number): void;
  (e: 'remove'): void;
  (e: 'openWheel'): void;
}>();

function slotBg(slot: any): string {
  if (slot.type === 'Color') {
    if (slot.colors.length >= 2) return `linear-gradient(135deg, ${slot.colors[0]} 50%, ${slot.colors[1]} 50%)`;
    return slot.colors[0] ?? '#ffffff';
  }
  const fallback: Record<string, string> = { Open: '#1e293b', Gobo: '#78716c', Prism: '#a78bfa', Frost: '#bfdbfe', Iris: '#94a3b8' };
  return fallback[slot.type] ?? '#64748b';
}
</script>

<template>
  <div class="rounded border border-border/40 bg-muted/5 p-2.5 space-y-2">
    <!-- Header: color dot + dmx range + delete -->
    <div class="flex items-center gap-1.5">
      <span class="size-2 rounded-full shrink-0 ring-1 ring-black/5"
        :style="{
          background: (range as any).wheelSlotId && wheel
            ? slotBg(wheel.slots.find(s => s.slotId === (range as any).wheelSlotId) ?? { type: 'Open', colors: [] })
            : CHANNEL_CAPABILITY_META[range.type as ChannelType]?.color
        }" />
      
      <template v-if="!isSingleFullRange">
        <div class="flex items-center gap-1 flex-1">
          <DraggableNumberInput label="Min" :model-value="range.dmxMin"
            @update:model-value="emit('patch', { dmxMin: $event })"
            :min="ri === 0 ? 0 : (prevMax ?? -1) + 1" :max="range.dmxMax" :step="1" class="flex-1" />
          <span class="text-muted-foreground/30 text-xs shrink-0">–</span>
          <DraggableNumberInput label="Max" :model-value="range.dmxMax"
            @update:model-value="emit('maxChange', $event)"
            :min="range.dmxMin" :max="ri === totalCaps - 1 ? 255 : (nextMax ?? 256) - 1" :step="1" class="flex-1" />
        </div>
        <button class="text-muted-foreground/30 hover:text-destructive shrink-0 transition-colors" @click="emit('remove')">
          <X class="size-3.5" />
        </button>
      </template>
      <span v-else class="text-[10px] text-muted-foreground/40 font-mono flex-1">0 – 255 (full range)</span>
    </div>

    <!-- Wheel slot picker -->
    <template v-if="wheel">
      <div class="flex items-center justify-between">
        <span class="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50">Slots</span>
        <button class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground/50 hover:text-foreground" @click="emit('openWheel')">
          <Disc3 class="size-3" /> Edit wheel
        </button>
      </div>
      <div v-if="wheel.slots.length === 0" class="text-[10px] text-muted-foreground/40 italic">No slots defined</div>
      <div v-else class="flex flex-wrap gap-1">
        <button
          v-for="slot in wheel.slots" :key="slot.slotId"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors"
          :class="(range as any).wheelSlotId === slot.slotId ? 'border-primary/60 bg-primary/5 text-foreground' : 'border-border/50 text-muted-foreground/50 hover:border-border hover:text-foreground'"
          @click="emit('patch', { wheelSlotId: (range as any).wheelSlotId === slot.slotId ? undefined : slot.slotId, type: selectedChannelType })"
        >
          <span class="size-2 rounded-full shrink-0" :style="{ background: slotBg(slot) }" />
          {{ slot.name || slot.type }}
        </button>
        <Select :model-value="(range as any).wheelSlotId ? '' : range.type" @update:model-value="emit('patch', { type: $event, wheelSlotId: undefined })">
          <SelectTrigger class="h-6 w-28 text-[10px] px-2 border-dashed" :class="!(range as any).wheelSlotId ? 'border-primary/60 bg-primary/5' : ''"><SelectValue placeholder="Other…" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="t in WHEEL_RANGE_TYPES" :key="t" :value="t" class="text-xs">{{ CHANNEL_CAPABILITY_META[t].label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </template>

    <!-- Normal type selector / label / fields -->
    <template v-else>
      <Select v-if="!isSingleFullRange" :model-value="range.type" @update:model-value="emit('patch', { type: $event as any })">
        <SelectTrigger class="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <template v-for="(items, group) in capabilityGroups" :key="group">
            <div class="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold">{{ group }}</div>
            <SelectItem v-for="item in items" :key="item.type" :value="item.type" class="text-xs pl-4">
              <div class="flex items-center gap-2"><span class="size-2 rounded-full ring-1 ring-black/10" :style="{ backgroundColor: CHANNEL_CAPABILITY_META[item.type].color }" />{{ item.label }}</div>
            </SelectItem>
          </template>
        </SelectContent>
      </Select>
      <Input :model-value="range.label" @update:model-value="emit('patch', { label: String($event) })" placeholder="Label / description (optional)" class="h-7 text-xs" />
      <CapabilityFieldGroup :range="range" :type="(range.type as ChannelType)" @patch="emit('patch', $event)" />
    </template>
  </div>
</template>
