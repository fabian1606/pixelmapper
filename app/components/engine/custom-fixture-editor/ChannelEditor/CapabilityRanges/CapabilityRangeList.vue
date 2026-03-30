<script setup lang="ts">
import { computed } from 'vue';
import {
  CHANNEL_CAPABILITY_META,
  CHANNEL_CAPABILITY_TYPES,
  type ChannelDraft,
  type WheelDraft,
} from '~/utils/engine/custom-fixture-types';
import type { ChannelType } from '~/utils/engine/types';
import CapabilityRangeItem from './CapabilityRangeItem.vue';

const props = defineProps<{
  channel: ChannelDraft;
  isSingleFullRange: boolean;
  wheel?: WheelDraft | null;
}>();

const emit = defineEmits<{
  (e: 'patchRange', rangeId: string, patch: Record<string, unknown>): void;
  (e: 'maxChange', rangeId: string, val: number): void;
  (e: 'removeRange', rangeId: string): void;
  (e: 'openWheel'): void;
}>();

const capabilityGroups = computed(() => {
  const groups: Record<string, { type: ChannelType; label: string }[]> = {};
  for (const type of CHANNEL_CAPABILITY_TYPES) {
    const { group, label } = CHANNEL_CAPABILITY_META[type as ChannelType];
    if (!groups[group]) groups[group] = [];
    groups[group].push({ type: type as ChannelType, label });
  }
  return groups;
});
</script>

<template>
  <div class="border-t px-3 pt-2 pb-3 space-y-2">
    <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">DMX Ranges</p>

    <!-- Visual bar -->
    <div class="h-2.5 w-full rounded overflow-hidden flex gap-px bg-muted/30">
      <template v-if="channel.capabilities.length === 0">
        <div class="h-full flex-1" :style="{ backgroundColor: CHANNEL_CAPABILITY_META[channel.capabilityType as ChannelType].color }" />
      </template>
      <template v-else>
        <div v-for="r in channel.capabilities" :key="r.rangeId" class="h-full" :style="{
          width: `${((r.dmxMax - r.dmxMin + 1) / 256) * 100}%`,
          backgroundColor: CHANNEL_CAPABILITY_META[r.type as ChannelType]?.color || '#555',
          minWidth: '2px',
        }" :title="`${r.dmxMin}–${r.dmxMax}`" />
      </template>
    </div>

    <!-- List -->
    <div class="space-y-2">
      <CapabilityRangeItem
        v-for="(r, ri) in channel.capabilities" :key="r.rangeId"
        :range="r" :ri="ri" :is-single-full-range="isSingleFullRange"
        :total-caps="channel.capabilities.length"
        :prev-max="channel.capabilities[ri-1]?.dmxMax"
        :next-max="channel.capabilities[ri+1]?.dmxMin"
        :capability-groups="capabilityGroups"
        :selected-channel-type="(channel.capabilityType as ChannelType)"
        :wheel="wheel"
        @patch="emit('patchRange', r.rangeId, $event)"
        @max-change="emit('maxChange', r.rangeId, $event)"
        @remove="emit('removeRange', r.rangeId)"
        @open-wheel="emit('openWheel')"
      />
    </div>
  </div>
</template>
