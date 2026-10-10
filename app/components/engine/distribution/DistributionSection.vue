<script setup lang="ts">
/**
 * Shared Distribution section of every modifier card (plan M4.1, revision
 * R1). One dropdown chooses how the modifier spreads: all the same, across
 * fixtures (direction on the canvas) or within each fixture. Across fixtures
 * offers the modes the manifest allows; Order has a single Reassign action.
 * Spatial values are edited on the canvas (principle 2).
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { CircleDot, ListOrdered, MoveRight, RotateCw } from 'lucide-vue-next';
import type { Distribution, DistributionMode, Vec2 } from '@pixelmapper/extension-api';
import type { ManifestDistribution } from '@pixelmapper/plugin-toolchain/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SegmentedControl, { type Segment } from '../SegmentedControl.vue';
import { useDistributionToolStore } from '~/stores/distribution-tool-store';

const props = defineProps<{
  modifierId: string;
  distribution: Distribution;
  /** Manifest options (offered modes and scopes). */
  options?: ManifestDistribution;
  /** Main axis of the edited fixtures (default handle for "Across fixtures"). */
  selectionAxis?: { a: Vec2; b: Vec2 };
}>();

const emit = defineEmits<{
  /** New distribution (one undo step). */
  update: [distribution: Distribution, description: string];
  'dropdown-open-change': [open: boolean];
}>();

/** The dropdown's choices. */
type Spread = 'same' | 'across' | 'within';

const MODES: Segment<DistributionMode>[] = [
  { value: 'linear', label: 'Linear', icon: MoveRight, title: 'Along a direction — drag the handle on the canvas' },
  { value: 'radial', label: 'Radial', icon: CircleDot, title: 'Outward from a center' },
  { value: 'conical', label: 'Conical', icon: RotateCw, title: 'Around a center' },
  { value: 'order', label: 'Order', icon: ListOrdered, title: 'In the order of the numbers on the canvas' },
];
const OFFSETS: Segment<'none' | 'order'>[] = [
  { value: 'none', label: 'None', title: 'Every fixture runs the same' },
  { value: 'order', label: 'By order', title: 'Fixtures follow each other in order' },
];

const toolStore = useDistributionToolStore();
const { modifierId: reassigning } = storeToRefs(toolStore);

const d = computed(() => props.distribution);
const offered = computed(() => props.options?.modes ?? ['none', 'linear', 'radial', 'conical', 'order']);
const modes = computed(() => MODES.filter(m => offered.value.includes(m.value)).sort((a, b) => offered.value.indexOf(a.value) - offered.value.indexOf(b.value)));
const spreads = computed(() => {
  const out: { value: Spread; label: string }[] = [];
  if (offered.value.includes('none')) out.push({ value: 'same', label: 'All the same' });
  if (modes.value.length) out.push({ value: 'across', label: 'Across fixtures' });
  if (!props.options?.scopes || props.options.scopes.includes('within')) out.push({ value: 'within', label: 'Within each fixture' });
  return out;
});
const spread = computed<Spread>(() => (d.value.scope === 'within' ? 'within' : d.value.mode === 'none' ? 'same' : 'across'));
const ordered = computed(() => (spread.value === 'across' && d.value.mode === 'order') || (spread.value === 'within' && d.value.withinOffset === 'order'));
const isReassigning = computed(() => reassigning.value === props.modifierId);

/** Switches the spread; entering "Across fixtures" starts with a direction along the selection. */
function setSpread(v: Spread) {
  if (v === spread.value) return;
  if (v === 'same') emit('update', { ...d.value, scope: 'across', mode: 'none' }, 'Spread: All the same');
  else if (v === 'within') emit('update', { ...d.value, scope: 'within' }, 'Spread: Within each fixture');
  else {
    const mode = modes.value.some(m => m.value === 'linear') ? 'linear' : modes.value[0]!.value;
    const handle = props.selectionAxis ? { origin: { ...props.selectionAxis.a }, end: { ...props.selectionAxis.b } } : {};
    emit('update', { ...d.value, ...handle, scope: 'across', mode }, 'Spread: Across fixtures');
  }
}

defineExpose({ setSpread });
</script>

<template>
  <section class="flex flex-col gap-2" data-distribution-section>
    <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Distribution</span>
    <div class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Spread</span>
      <Select :model-value="spread" @update:model-value="v => setSpread(v as Spread)" @update:open="v => emit('dropdown-open-change', v)">
        <SelectTrigger class="h-7 flex-1 min-w-0 text-xs" aria-label="Spread" data-spread>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="s in spreads" :key="s.value" :value="s.value" class="text-xs">{{ s.label }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div v-if="spread === 'across'" class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Mode</span>
      <SegmentedControl class="flex-1" aria-label="Mode" :options="modes" :model-value="d.mode" @update:model-value="v => emit('update', { ...d, mode: v }, 'Change Distribution Mode')" />
    </div>
    <div v-if="spread === 'within'" class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground leading-tight">Offset</span>
      <SegmentedControl class="flex-1" aria-label="Offset per fixture" :options="OFFSETS" :model-value="d.withinOffset" @update:model-value="v => emit('update', { ...d, withinOffset: v }, 'Change Within Offset')" />
    </div>
    <p v-if="spread === 'across' && d.mode !== 'order'" class="text-[11px] text-muted-foreground truncate">Drag the handle on the canvas</p>
    <div v-if="ordered" class="flex items-center gap-2">
      <span class="flex-1 min-w-0 truncate text-[11px] text-muted-foreground">{{ isReassigning ? 'Click fixtures or draw a line on the canvas' : 'Numbers on the canvas set the order' }}</span>
      <button
        type="button"
        class="shrink-0 rounded px-2 h-6 border text-[11px] transition-colors"
        :class="isReassigning ? 'text-primary bg-primary/10 border-primary/40' : 'border-border/60 text-foreground hover:bg-muted/50'"
        :aria-pressed="isReassigning"
        data-reassign
        @click.stop="toolStore.toggle(modifierId)"
      >
        {{ isReassigning ? 'Done' : 'Reassign' }}
      </button>
    </div>
  </section>
</template>
