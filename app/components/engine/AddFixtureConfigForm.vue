<script setup lang="ts">
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Plus } from 'lucide-vue-next';
import { computed } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';
import { useEngineStore } from '~/stores/engine-store';

interface Config {
  modeIndex: string;
  universe: number;
  address: number;
  amount: number;
}

const props = defineProps<{
  fullFixtureData: OflFixture | null;
}>();

const config = defineModel<Config>({ required: true });

defineEmits<{
  (e: 'add'): void;
}>();

const engineStore = useEngineStore();

const isAddressOccupied = computed(() => {
  if (!props.fullFixtureData) return false;
  
  const modeIdx = parseInt(config.value.modeIndex, 10);
  const selectedMode = props.fullFixtureData.modes[modeIdx];
  const footprint = selectedMode ? selectedMode.channels.length : 1;
  const totalChannels = footprint * config.value.amount;
  
  const startAbs = (config.value.universe - 1) * 512 + config.value.address;
  const endAbs = startAbs + totalChannels - 1;

  for (const f of engineStore.flatFixtures) {
    const fStart = f.startAddress;
    const fEnd = fStart + f.channels.length - 1;
    // Check overlap
    if (startAbs <= fEnd && endAbs >= fStart) {
      return true;
    }
  }
  return false;
});
</script>

<template>
  <div class="grid grid-cols-14 gap-6 items-end">
    <!-- Mode Selection -->
    <div class="col-span-12 md:col-span-4 space-y-2.5">
      <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">DMX Mode</Label>
      <Select
        v-model="config.modeIndex"
        :disabled="!fullFixtureData"
      >
        <SelectTrigger class="h-10 bg-background border-border">
          <SelectValue placeholder="Select mode" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="(mode, idx) in fullFixtureData?.modes"
            :key="idx"
            :value="String(idx)"
            class="text-xs"
          >
            {{ mode.name }} <span class="ml-2 opacity-50">({{ mode.channels.length }}ch)</span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- DMX Configuration -->
    <div class="col-span-4 md:col-span-2 space-y-2.5">
      <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Universe</Label>
      <Input
        v-model.number="config.universe"
        type="number"
        min="1"
        class="h-10 bg-background w-20"
      />
    </div>

    <div class="col-span-4 md:col-span-2 space-y-2.5">
      <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Address</Label>
      <Input
        v-model.number="config.address"
        type="number"
        min="1"
        max="512"
        class="h-10 w-20 transition-colors"
        :class="isAddressOccupied ? 'border-destructive bg-destructive/10 text-destructive focus-visible:ring-destructive' : 'bg-background'"
      />
    </div>

    <div class="col-span-4 md:col-span-2 space-y-2.5">
      <Label class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Amount</Label>
      <Input
        v-model.number="config.amount"
        type="number"
        min="1"
        max="50"
        class="h-10 bg-background w-20"
      />
    </div>

    <!-- Actions -->
    <div class="col-span-12 md:col-span-4 flex items-center justify-end gap-3 pb-0.5 ml-auto">
      <Button
        :disabled="!fullFixtureData"
        @click="$emit('add')"
        class="px-6 h-10 font-bold tracking-tight shadow-lg shadow-primary/20"
      >
        <Plus class="size-4 mr-2" />
        Add {{ config.amount }} Fixture{{ config.amount > 1 ? 's' : '' }}
      </Button>
    </div>
  </div>
</template>
