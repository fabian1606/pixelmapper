<script setup lang="ts">
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';

defineProps<{
  channelsRaw: string;
}>();

const emit = defineEmits<{
  (e: 'update:channelsRaw', value: string): void;
}>();
</script>

<template>
  <div class="space-y-2">
    <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">DMX</p>
    <DraggableNumberInput
      label="Channels"
      :model-value="Number(channelsRaw)"
      @update:model-value="emit('update:channelsRaw', String($event))"
      :min="1" :max="512" :step="1"
    />
    <p class="text-[9px] text-muted-foreground/50">Channel binding will be configured after saving.</p>
  </div>
</template>
