<script setup lang="ts">
import { MousePointerClick, SlidersHorizontal, Crosshair, Type } from 'lucide-vue-next';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { AddLiveWidgetCommand } from '~/components/engine/commands/live-widget-commands';
import { defaultLiveWidget, type LiveWidgetType } from '~/utils/live/types';

const store = useLiveModeStore();
const history = useHistory();

const WIDGET_TYPES: { type: LiveWidgetType; label: string; icon: typeof MousePointerClick }[] = [
  { type: 'button', label: 'Button', icon: MousePointerClick },
  { type: 'slider', label: 'Slider', icon: SlidersHorizontal },
  { type: 'xy-pad', label: 'XY Pad', icon: Crosshair },
  { type: 'label', label: 'Label', icon: Type },
];

function addWidget(type: LiveWidgetType) {
  if (!store.activePageId) return;
  const widget = defaultLiveWidget(type, 0, 0);
  history.execute(new AddLiveWidgetCommand(store.activePageId, widget));
}
</script>

<template>
  <div class="w-16 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-border bg-background">
    <button
      v-for="item in WIDGET_TYPES"
      :key="item.type"
      class="w-full flex flex-col items-center gap-1 py-2 px-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      :title="item.label"
      @click="addWidget(item.type)"
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span class="text-[9px] font-medium leading-none">{{ item.label }}</span>
    </button>
  </div>
</template>
