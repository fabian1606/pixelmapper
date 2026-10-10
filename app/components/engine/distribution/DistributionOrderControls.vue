<script setup lang="ts">
/**
 * Order controls of the Distribution section (plan M4.1): canvas tools
 * (click fixtures / draw line), Snap (after a line was drawn), Reverse,
 * Mirror (symmetric from the line start) and Clear.
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { ArrowLeftRight, FlipHorizontal2, PenLine, Pointer, X } from 'lucide-vue-next';
import type { Distribution } from '@pixelmapper/extension-api';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import { useDistributionToolStore, type DistributionTool } from '~/stores/distribution-tool-store';

const props = defineProps<{
  modifierId: string;
  distribution: Distribution;
}>();

const emit = defineEmits<{
  update: [distribution: Distribution, description: string, continuous: boolean];
}>();

const toolStore = useDistributionToolStore();
const { tool, modifierId: toolModifier } = storeToRefs(toolStore);

const order = computed(() => props.distribution.order);
const TOOLS: { value: DistributionTool; label: string; icon: typeof Pointer; title: string }[] = [
  { value: 'click', label: 'Click fixtures', icon: Pointer, title: 'Click fixtures in order (Shift-click = same step)' },
  { value: 'line', label: 'Draw line', icon: PenLine, title: 'Draw a line through the rig' },
];

/** True when `t` is the active tool of this modifier. */
const isActive = (t: DistributionTool) => tool.value === t && toolModifier.value === props.modifierId;

/** Emits the distribution with `order` patched. */
function setOrder(changes: Partial<Distribution['order']>, description: string, continuous = false) {
  emit('update', { ...props.distribution, order: { ...order.value, ...changes } }, description, continuous);
}

/** Removes clicked ranks and the drawn line (ranks fall back to the selection axis). */
function clear() {
  toolStore.stop();
  emit('update', { ...props.distribution, order: { ...order.value, ranks: {}, line: undefined, mirror: false } }, 'Clear Order', false);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Tool</span>
      <div class="flex flex-1 min-w-0 gap-1">
        <button
          v-for="t in TOOLS" :key="t.value" type="button"
          class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 h-6 border text-[11px] transition-colors"
          :class="isActive(t.value) ? 'text-primary bg-primary/10 border-primary/40' : 'border-border/60 text-muted-foreground hover:text-foreground'"
          :aria-pressed="isActive(t.value)" :title="t.title" :data-tool="t.value"
          @click.stop="toolStore.toggle(t.value, modifierId)"
        >
          <component :is="t.icon" class="h-3.5 w-3.5 shrink-0" /><span class="truncate">{{ t.label }}</span>
        </button>
      </div>
    </div>
    <div v-if="order.line" class="flex items-center gap-2" data-snap>
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Snap</span>
      <Replaceable
        name="pm.fader" class="flex-1" :model-value="order.snap" :min="0" :max="1" :step="0.01" size="sm"
        title="Fixtures closer than this share a step"
        @update:model-value="(v: number) => setOrder({ snap: v }, 'Change Order Snap', true)"
      />
    </div>
    <div class="flex items-center gap-1 justify-end text-[11px]">
      <button
        type="button" class="flex items-center gap-1 rounded px-1.5 h-6 border transition-colors"
        :class="distribution.reverse ? 'text-primary bg-primary/10 border-primary/30' : 'border-border/60 text-muted-foreground hover:text-foreground'"
        :aria-pressed="distribution.reverse" title="Reverse"
        @click.stop="emit('update', { ...distribution, reverse: !distribution.reverse }, 'Reverse Distribution', false)"
      >
        <ArrowLeftRight class="h-3.5 w-3.5" /> Reverse
      </button>
      <button
        v-if="order.line" type="button" class="flex items-center gap-1 rounded px-1.5 h-6 border transition-colors"
        :class="order.mirror ? 'text-primary bg-primary/10 border-primary/30' : 'border-border/60 text-muted-foreground hover:text-foreground'"
        :aria-pressed="!!order.mirror" title="Symmetric: both sides of the line start move together"
        @click.stop="setOrder({ mirror: !order.mirror }, 'Mirror Order')"
      >
        <FlipHorizontal2 class="h-3.5 w-3.5" /> Mirror
      </button>
      <button
        type="button" class="flex items-center gap-1 rounded px-1.5 h-6 border border-border/60 text-muted-foreground hover:text-foreground"
        title="Clear the order" data-clear
        @click.stop="clear"
      >
        <X class="h-3.5 w-3.5" /> Clear
      </button>
    </div>
  </div>
</template>
