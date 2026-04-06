<script setup lang="ts">
import { computed, ref } from 'vue';
import { useUniverseInspector } from '~/composables/use-universe-inspector';
import { useEngineStore } from '~/stores/engine-store';
import DmxChannelFader from './DmxChannelFader.vue';

const props = defineProps<{
  universe: number;
  active?: boolean;
}>();

const engineStore = useEngineStore();
const { buildChannelGroups, setOverride, isOverridden } = useUniverseInspector();

const groups = computed(() => buildChannelGroups(props.universe));
const faderContainerRef = ref<HTMLElement | null>(null);

function handleFaderUpdate(bufferIndex: number, value: number) {
  setOverride(bufferIndex, value);
}

function groupIsSelected(group: any) {
  if (!group.isAssigned) return false;
  return group.channels.some((ch: any) => ch.fixture && engineStore.selectedIds.has(ch.fixture.id));
}

function scrollToChannel(bufferIndex: number) {
  const container = faderContainerRef.value;
  if (!container) return;
  // Find the fader element by data attribute
  const faderEl = container.querySelector(`[data-buffer-index="${bufferIndex}"]`);
  if (faderEl) {
    faderEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }
}

defineExpose({ scrollToChannel });
</script>

<template>
  <div class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-3 pb-3">
    <div ref="faderContainerRef" class="flex gap-0.5 h-full pt-1">
      <template v-for="(group, idx) in groups" :key="group.label + group.channels[0]?.bufferIndex">
        <div class="flex flex-col shrink-0">
          <!-- Group banner (only if assigned) -->
          <div
            v-if="group.isAssigned"
            class="text-[10px] font-bold text-center px-2 py-1 mb-1 rounded-sm truncate border transition-all"
            :class="groupIsSelected(group) 
              ? 'bg-amber-400/20 text-amber-400 border-amber-500/40 shadow-[0_0_10px_rgba(251,191,36,0.1)]' 
              : 'bg-muted/40 text-muted-foreground border-border/40'"
            :title="group.label"
            :style="{ width: group.channels.length * 36 + (group.channels.length - 1) * 2 + 'px' }"
          >
            {{ group.label }}
          </div>
          <div v-else class="h-[21px] mb-1" />

          <div class="flex gap-0.5">
            <DmxChannelFader
              v-for="ch in group.channels"
              :key="ch.bufferIndex"
              :data-buffer-index="ch.bufferIndex"
              :channel-info="ch"
              :is-overridden="isOverridden(ch.bufferIndex)"
              :active="props.active"
              @update:value="(v) => handleFaderUpdate(ch.bufferIndex, v)"
              @clear-override="engineStore.clearOverride(ch.bufferIndex)"
            />
          </div>
        </div>

        <div
          v-if="idx < groups.length - 1"
          class="w-px bg-border/20 self-stretch mx-0.5 mt-6 shrink-0"
        />
      </template>
    </div>
  </div>
</template>
