<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { OflCapability, OflWheelSlot } from '~/utils/ofl/types';
import type { ChannelType } from '~/utils/engine/types';

const props = defineProps<{
  type: ChannelType;
  capabilities: OflCapability[];
  activeCapability: OflCapability | null;
  activeCapabilityLabel: string;
  resolveSlot: (cap: OflCapability) => OflWheelSlot | null;
  capabilityLabel: (cap: OflCapability) => string;
}>();

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void;
  (e: 'select-value', value: number): void;
}>();

function onDropdownOpenChange(open: boolean) {
  emit('update:open', open);
}

function handleValueChange(value: number) {
  emit('select-value', value);
}
</script>

<template>
  <DropdownMenu @update:open="onDropdownOpenChange">
    <DropdownMenuTrigger as-child>
      <button
        class="text-xs text-muted-foreground hover:text-foreground text-left truncate flex items-center gap-1 w-fit rounded-sm transition-colors focus:outline-none"
        :title="activeCapabilityLabel"
      >
        <span class="truncate max-w-[140px]">{{ activeCapabilityLabel }}</span>
        <span v-if="capabilities.length > 1" class="text-[10px] opacity-40 flex-shrink-0">▼</span>
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent :align="'start'" class="w-56 max-h-64 overflow-y-auto">
      <template v-if="capabilities.length > 1">
        <DropdownMenuItem
          v-for="(cap, i) in capabilities"
          :key="i"
          class="text-xs gap-2"
          :class="activeCapability === cap ? 'bg-accent/60' : ''"
          @click="cap.dmxRange && handleValueChange(cap.dmxRange[0])"
        >
          <!-- Slot color swatch for color wheel -->
          <div
            v-if="type === 'COLOR_WHEEL' && resolveSlot(cap)?.colors?.[0]"
            class="w-3 h-3 rounded-sm flex-shrink-0"
            :style="{ backgroundColor: resolveSlot(cap)?.colors?.[0] }"
          />
          <span class="flex-1">{{ capabilityLabel(cap) }}</span>
          <span v-if="cap.dmxRange" class="text-muted-foreground ml-1 font-mono text-[10px] flex-shrink-0">
            {{ cap.dmxRange[0] }}
          </span>
        </DropdownMenuItem>
      </template>
      <template v-else>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="text-xs" @click="handleValueChange(0)">Off (0)</DropdownMenuItem>
        <DropdownMenuItem class="text-xs" @click="handleValueChange(127)">Half (127)</DropdownMenuItem>
        <DropdownMenuItem class="text-xs" @click="handleValueChange(255)">Full (255)</DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
