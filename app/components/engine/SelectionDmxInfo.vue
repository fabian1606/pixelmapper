<script setup lang="ts">
import type { Fixture } from '~/utils/engine/core/fixture';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import { Label } from '@/components/ui/label';
import { useVModel } from '@vueuse/core';

const props = defineProps<{
  universe: number;
  localAddress: number;
  fixtureCount?: number;
}>();

const emit = defineEmits<{
  (e: 'update:universe', val: number): void;
  (e: 'update:localAddress', val: number): void;
  (e: 'changeUniverse', val: number): void;
  (e: 'changeAddress', val: number): void;
}>();

const universe = useVModel(props, 'universe', emit);
const localAddress = useVModel(props, 'localAddress', emit);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <Label class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">DMX Settings</Label>
      <span v-if="fixtureCount" class="text-[9px] text-muted-foreground/50 font-mono">
        m: {{ fixtureCount }}ch
      </span>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <Replaceable name="pm.numberInput" 
        label="U" 
        :min="1"
        v-model="universe"
        @commit="(val: number) => emit('changeUniverse', val)"
      />
      <Replaceable name="pm.numberInput" 
        label="A" 
        :min="1" 
        :max="512"
        v-model="localAddress"
        @commit="(val: number) => emit('changeAddress', val)"
      />
    </div>
  </div>
</template>
