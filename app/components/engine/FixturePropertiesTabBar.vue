<script setup lang="ts">
import { OctagonX } from 'lucide-vue-next';
import { CHANNEL_CATEGORIES, type ChannelCategoryKey } from '~/utils/engine/channel-categories';

defineProps<{
  availableTabs: Record<string, number> & { total?: number };
  modifiedCategories: Set<string>;
  activeTab: ChannelCategoryKey | null;
  stopAllTooltip: string;
}>();

const emit = defineEmits<{
  (e: 'toggleTab', tab: ChannelCategoryKey): void;
  (e: 'stopAllOrSelected'): void;
}>();
</script>

<template>
  <div class="pointer-events-auto w-12 bg-background border-l border-border flex flex-col items-center py-4 gap-2 z-20">
    <button
      v-for="cat in CHANNEL_CATEGORIES"
      :key="cat.id"
      v-show="(availableTabs[cat.id] ?? 0) > 0"
      class="p-2 rounded-md transition-colors relative"
      :class="activeTab === cat.id ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
      @click="emit('toggleTab', cat.id)"
      :title="cat.label + ' Properties'"
    >
      <span 
        v-if="modifiedCategories.has(cat.id)" 
        class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
        :class="activeTab === cat.id ? 'bg-primary' : 'bg-muted-foreground'"
      ></span>
      <component :is="cat.icon" class="size-5" />
    </button>

    <div class="flex-1"></div>

    <button
      class="p-2 rounded-md transition-colors text-muted-foreground hover:text-red-500 hover:bg-muted"
      @click="emit('stopAllOrSelected')"
      :title="stopAllTooltip"
    >
      <OctagonX class="size-5" />
    </button>
  </div>
</template>
