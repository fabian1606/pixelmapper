<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import {
  CHANNEL_CAPABILITY_META,
  CHANNEL_CAPABILITY_TYPES,
  type ChannelDraft,
} from '~/utils/engine/custom-fixture-types';
import type { ChannelType } from '~/utils/engine/types';

const props = defineProps<{
  channel: ChannelDraft;
}>();

const emit = defineEmits<{
  (e: 'update', patch: Partial<ChannelDraft>): void;
  (e: 'changeType', newType: string): void;
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
  <div class="p-3 space-y-2">
    <!-- Name -->
    <div class="flex items-center gap-2">
      <span class="size-3 rounded-full shrink-0 ring-1 ring-black/10"
        :style="{ backgroundColor: CHANNEL_CAPABILITY_META[channel.capabilityType as ChannelType].color }" />
      <input :value="channel.name"
        @input="emit('update', { name: ($event.target as HTMLInputElement).value })"
        placeholder="Channel name"
        class="flex-1 bg-transparent outline-none border-none text-sm font-medium placeholder:text-muted-foreground/40 min-w-0" />
    </div>

    <!-- Type -->
    <Select :model-value="channel.capabilityType"
      @update:model-value="emit('changeType', $event as string)">
      <SelectTrigger class="h-7 text-xs w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <template v-for="(items, group) in capabilityGroups" :key="group">
          <div class="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold">{{ group }}</div>
          <SelectItem v-for="item in items" :key="item.type" :value="item.type" class="text-xs pl-4">
            <div class="flex items-center gap-2">
              <span class="size-2 rounded-full ring-1 ring-black/10"
                :style="{ backgroundColor: CHANNEL_CAPABILITY_META[item.type].color }" />
              {{ item.label }}
            </div>
          </SelectItem>
        </template>
      </SelectContent>
    </Select>

    <!-- Resolution -->
    <div class="grid grid-cols-2 gap-1.5">
      <Button variant="outline" size="sm" class="h-8 text-xs"
        :class="channel.resolution === '8bit' ? 'bg-muted/60 text-foreground font-semibold' : ''"
        @click="emit('update', { resolution: '8bit' })">
        8-bit <span class="text-muted-foreground/50 ml-1 text-[9px]">1 addr</span>
      </Button>
      <Button variant="outline" size="sm" class="h-8 text-xs"
        :class="channel.resolution === '16bit' ? 'bg-muted/60 text-foreground font-semibold' : ''"
        @click="emit('update', { resolution: '16bit' })">
        16-bit <span class="text-muted-foreground/50 ml-1 text-[9px]">2 addr</span>
      </Button>
    </div>

    <!-- Default Value -->
    <DraggableNumberInput label="Default" :model-value="channel.defaultValue"
      @update:model-value="emit('update', { defaultValue: $event })"
      :min="0" :max="255" :step="1" />
  </div>
</template>
