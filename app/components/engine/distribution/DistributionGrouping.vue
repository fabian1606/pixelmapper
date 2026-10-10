<script setup lang="ts">
/**
 * Grouping row of the Distribution section (plan M4.1):
 * [None] [Every N ▾2] [Sections ▾4] [Random ⟳]. The group count steps
 * inline; Random re-seeds. Group colors match the canvas and `pm.steps`.
 */
import { computed } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import type { DistributionGrouping, GroupingKind } from '@pixelmapper/extension-api';
import SegmentedControl, { type Segment } from '../SegmentedControl.vue';
import { GROUP_COLORS } from './group-colors';

const props = defineProps<{
  grouping: DistributionGrouping;
  /** Grouping cannot be turned off (e.g. Pattern). */
  required?: boolean;
}>();

const emit = defineEmits<{
  update: [grouping: DistributionGrouping];
}>();

const KINDS: Segment<GroupingKind>[] = [
  { value: 'none', label: 'None' },
  { value: 'everyN', label: 'Every N', title: 'Every Nth fixture is in the same group' },
  { value: 'sections', label: 'Sections', title: 'Consecutive blocks' },
  { value: 'random', label: 'Random', title: 'Random, evenly sized groups' },
];
const kinds = computed(() => (props.required ? KINDS.filter(k => k.value !== 'none') : KINDS));

/** Switches kind; Sections defaults to 4 groups when coming from None. */
function setKind(kind: GroupingKind) {
  const n = props.grouping.kind === 'none' && kind === 'sections' ? 4 : props.grouping.n;
  emit('update', { ...props.grouping, kind, n });
}

/** Steps the group count (2–8). */
function stepN(dir: number) {
  emit('update', { ...props.grouping, n: Math.max(2, Math.min(8, Math.round(props.grouping.n) + dir)) });
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Grouping</span>
      <SegmentedControl class="flex-1" aria-label="Grouping" :options="kinds" :model-value="grouping.kind" @update:model-value="setKind" />
    </div>
    <div v-if="grouping.kind !== 'none'" class="flex items-center gap-1.5 pl-16 text-[11px] text-muted-foreground" data-group-count>
      <span>Groups</span>
      <button type="button" class="px-1 rounded hover:bg-muted disabled:opacity-40" aria-label="Fewer groups" :disabled="grouping.n <= 2" @click.stop="stepN(-1)">◀</button>
      <span class="font-mono text-foreground w-3 text-center">{{ grouping.n }}</span>
      <button type="button" class="px-1 rounded hover:bg-muted disabled:opacity-40" aria-label="More groups" :disabled="grouping.n >= 8" @click.stop="stepN(1)">▶</button>
      <span class="flex gap-0.5 ml-1" aria-hidden="true">
        <span v-for="g in grouping.n" :key="g" class="h-2 w-2 rounded-full" :style="{ background: GROUP_COLORS[(g - 1) % GROUP_COLORS.length] }" />
      </span>
      <button
        v-if="grouping.kind === 'random'" type="button" class="ml-auto flex items-center gap-1 rounded px-1.5 h-6 hover:text-foreground"
        title="Shuffle the groups" @click.stop="emit('update', { ...grouping, seed: (grouping.seed * 1103515245 + 12345) >>> 0 || 1 })"
      >
        <RefreshCw class="h-3.5 w-3.5" /> Shuffle
      </button>
    </div>
  </div>
</template>
