<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-vue-next';
import { 
  CHANNEL_CAPABILITY_META,
  type ChannelDraft,
  type ChannelType
} from '~/utils/engine/custom-fixture-types';

defineProps<{
  channels: ChannelDraft[];
  selectedChannelId: string | null;
}>();

const emit = defineEmits<{
  (e: 'add'): void;
  (e: 'delete', id: string): void;
  (e: 'select', id: string): void;
}>();
</script>

<template>
  <div class="flex-1 border-r flex flex-col min-h-0 min-w-0">
    <div class="border-b bg-muted/10 shrink-0 px-3 py-2 flex items-center justify-between">
      <p class="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
        Channels <span class="font-normal text-muted-foreground/40">({{ channels.length }})</span>
      </p>
      <Button size="sm" variant="ghost" class="h-6 px-2 gap-1 text-xs" @click="emit('add')">
        <Plus class="size-3" /> Add
      </Button>
    </div>
    
    <div class="flex-1 overflow-y-auto min-h-0">
      <div v-if="channels.length === 0"
        class="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground/40 text-xs">
        <Button size="sm" variant="outline" class="gap-1.5" @click="emit('add')">
          <Plus class="size-3.5" /> Add first channel
        </Button>
      </div>
      <div
        v-for="c in channels" :key="c.id"
        class="flex items-center gap-2 px-3 py-2 border-b border-border/40 group cursor-pointer hover:bg-muted/20 transition-colors"
        :class="selectedChannelId === c.id
          ? 'bg-muted/30 border-l-2 border-l-primary'
          : 'border-l-2 border-l-transparent'"
        @click="emit('select', c.id)"
      >
        <span class="size-2.5 rounded-full shrink-0 ring-1 ring-black/10"
          :style="{ backgroundColor: CHANNEL_CAPABILITY_META[c.capabilityType as ChannelType]?.color }" />
        <span class="flex-1 text-xs font-medium truncate">{{ c.name }}</span>
        <button class="opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive shrink-0"
          @click.stop="emit('delete', c.id)">
          <Trash2 class="size-3" />
        </button>
      </div>
    </div>
  </div>
</template>
