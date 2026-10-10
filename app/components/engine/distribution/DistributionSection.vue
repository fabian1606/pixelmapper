<script setup lang="ts">
/**
 * Shared Distribution section of every modifier card (plan M4.1, replaces
 * `ChaserFanningControl`). Shows only what the manifest offers: scope,
 * mode, then per mode the canvas hint (gradient modes) or the order tools,
 * grouping, and the within-fixture offset. Spatial values themselves are
 * edited on the canvas (principle 2).
 */
import { computed } from 'vue';
import { ArrowLeftRight, CircleDot, Equal, ListOrdered, MoveRight, RotateCw } from 'lucide-vue-next';
import type { Distribution, DistributionMode, DistributionScope } from '@pixelmapper/extension-api';
import type { ManifestDistribution } from '@pixelmapper/plugin-toolchain/types';
import SegmentedControl, { type Segment } from '../SegmentedControl.vue';
import DistributionOrderControls from './DistributionOrderControls.vue';
import DistributionGrouping from './DistributionGrouping.vue';

const props = defineProps<{
  modifierId: string;
  distribution: Distribution;
  /** Manifest options (offered modes, scopes, grouping). */
  options?: ManifestDistribution;
}>();

const emit = defineEmits<{
  /** New distribution; `continuous` edits are coalesced by the caller. */
  update: [distribution: Distribution, description: string, continuous: boolean];
}>();

const MODES: Segment<DistributionMode>[] = [
  { value: 'none', label: 'All same', icon: Equal, title: 'Every fixture does the same' },
  { value: 'linear', label: 'Linear', icon: MoveRight, title: 'Along a direction (drag the handle on the canvas)' },
  { value: 'radial', label: 'Radial', icon: CircleDot, title: 'Outward from a center' },
  { value: 'conical', label: 'Conical', icon: RotateCw, title: 'Around a center' },
  { value: 'order', label: 'Order', icon: ListOrdered, title: 'In an order you click or draw' },
];
const SCOPES: Segment<DistributionScope>[] = [
  { value: 'across', label: 'Across fixtures' },
  { value: 'within', label: 'Within each fixture' },
];
const OFFSETS: Segment<'none' | 'order'>[] = [
  { value: 'none', label: 'None' },
  { value: 'order', label: 'By order' },
];

const d = computed(() => props.distribution);
const modes = computed(() => {
  const offered = props.options?.modes;
  return offered ? MODES.filter(m => offered.includes(m.value)).sort((a, b) => offered.indexOf(a.value) - offered.indexOf(b.value)) : MODES;
});
const scopes = computed(() => SCOPES.filter(s => !props.options?.scopes || props.options.scopes.includes(s.value)));
const gradient = computed(() => d.value.scope === 'across' && ['linear', 'radial', 'conical'].includes(d.value.mode));
const ordered = computed(() => (d.value.scope === 'across' && d.value.mode === 'order') || (d.value.scope === 'within' && d.value.withinOffset === 'order'));
const groupingOffered = computed(() => props.options?.grouping !== false && (d.value.scope === 'within' || d.value.mode !== 'none'));

/** Emits a patched distribution. */
function patch(changes: Partial<Distribution>, description: string, continuous = false) {
  emit('update', { ...d.value, ...changes }, description, continuous);
}
</script>

<template>
  <section class="flex flex-col gap-2" data-distribution-section>
    <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Distribution</span>
    <div v-if="scopes.length > 1" class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Scope</span>
      <SegmentedControl class="flex-1" aria-label="Scope" :options="scopes" :model-value="d.scope" @update:model-value="v => patch({ scope: v }, 'Change Distribution Scope')" />
    </div>
    <div v-if="d.scope === 'across'" class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground">Mode</span>
      <SegmentedControl class="flex-1" aria-label="Mode" :options="modes" :model-value="d.mode" @update:model-value="v => patch({ mode: v }, 'Change Distribution Mode')" />
    </div>
    <div v-else class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] text-muted-foreground leading-tight">Offset per fixture</span>
      <SegmentedControl class="flex-1" aria-label="Offset per fixture" :options="OFFSETS" :model-value="d.withinOffset" @update:model-value="v => patch({ withinOffset: v }, 'Change Within Offset')" />
    </div>

    <div v-if="gradient" class="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span class="flex-1 truncate">Drag the handle on the canvas</span>
      <button
        type="button" class="flex items-center gap-1 rounded px-1.5 h-6 border transition-colors"
        :class="d.reverse ? 'text-primary bg-primary/10 border-primary/30' : 'border-border/60 hover:text-foreground'"
        :aria-pressed="d.reverse" title="Reverse"
        @click.stop="patch({ reverse: !d.reverse }, 'Reverse Distribution')"
      >
        <ArrowLeftRight class="h-3.5 w-3.5" /> Reverse
      </button>
    </div>

    <DistributionOrderControls
      v-if="ordered"
      :modifier-id="modifierId" :distribution="d"
      @update="(next, desc, cont) => emit('update', next, desc, cont)"
    />
    <DistributionGrouping
      v-if="groupingOffered"
      :grouping="d.grouping" :required="options?.grouping === 'required'"
      @update="g => patch({ grouping: g }, 'Change Grouping')"
    />
  </section>
</template>
