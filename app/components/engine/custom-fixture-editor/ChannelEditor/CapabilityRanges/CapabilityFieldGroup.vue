<script setup lang="ts">
import {
  CAPABILITY_RANGE_FIELDS,
  type CapabilityRange,
  type CapabilityFieldSpec,
  type UnitOption,
} from '~/utils/engine/custom-fixture-types';
import type { ChannelType } from '~/utils/engine/types';
import { ArrowLeftRight } from 'lucide-vue-next';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';

const props = defineProps<{
  range: CapabilityRange;
  type: ChannelType;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

type CombinedGroup = {
  label: string;
  root: string;
  fixedSpec?: CapabilityFieldSpec;
  rangeSpecs?: [CapabilityFieldSpec, CapabilityFieldSpec];
};

function combinedRangeFields(type: ChannelType): CombinedGroup[] {
  const specs = (CAPABILITY_RANGE_FIELDS as Record<string, CapabilityFieldSpec[] | undefined>)[type] ?? [];
  const byRoot = new Map<string, { fixed?: CapabilityFieldSpec; start?: CapabilityFieldSpec; end?: CapabilityFieldSpec }>();

  for (const spec of specs) {
    const isStart = spec.key.endsWith('Start');
    const isEnd = spec.key.endsWith('End');
    const root = spec.key.replace(/Start$|End$/, '');
    if (!byRoot.has(root)) byRoot.set(root, {});
    const entry = byRoot.get(root)!;
    if (isStart) entry.start = spec;
    else if (isEnd) entry.end = spec;
    else entry.fixed = spec;
  }

  const result: CombinedGroup[] = [];
  for (const [root, { fixed, start, end }] of byRoot) {
    const label = root.replace(/([A-Z])/g, ' $1').trim().replace(/^./, (s: string) => s.toUpperCase());
    result.push({ label, root, fixedSpec: fixed, rangeSpecs: start && end ? [start, end] : undefined });
  }
  return result;
}

function isRangeMode(r: CapabilityRange, group: CombinedGroup): boolean {
  if (!group.rangeSpecs) return false;
  const rangeSet = (r as any)[group.rangeSpecs[0].key] !== undefined || (r as any)[group.rangeSpecs[1].key] !== undefined;
  const fixedSet = group.fixedSpec ? (r as any)[group.fixedSpec.key] !== undefined : false;
  return rangeSet || !fixedSet;
}

function activeUnit(r: CapabilityRange, unitKey: string, unitOptions: UnitOption[]): UnitOption {
  const stored = (r as any)[unitKey] as string | undefined;
  return unitOptions.find(u => u.value === stored) ?? unitOptions[0]!;
}

function toggleRangeMode(group: CombinedGroup) {
  const currentlyRange = isRangeMode(props.range, group);
  const patch: Record<string, unknown> = {};
  if (currentlyRange) {
    if (group.rangeSpecs) { patch[group.rangeSpecs[0].key] = undefined; patch[group.rangeSpecs[1].key] = undefined; }
    if (group.fixedSpec) {
      const u = group.fixedSpec.unitOptions ? activeUnit(props.range, group.fixedSpec.unitKey!, group.fixedSpec.unitOptions) : null;
      patch[group.fixedSpec.key] = u ? u.defaultFixed : (group.fixedSpec.defaultValue ?? 0);
    }
  } else {
    if (group.fixedSpec) patch[group.fixedSpec.key] = undefined;
    if (group.rangeSpecs) {
      const u = group.rangeSpecs[0].unitOptions ? activeUnit(props.range, group.rangeSpecs[0].unitKey!, group.rangeSpecs[0].unitOptions) : null;
      patch[group.rangeSpecs[0].key] = u ? u.defaultStart : (group.rangeSpecs[0].defaultValue ?? 0);
      patch[group.rangeSpecs[1].key] = u ? u.defaultEnd : (group.rangeSpecs[1].defaultValue ?? 0);
    }
  }
  emit('patch', patch);
}

function changeUnit(group: CombinedGroup, newUnit: UnitOption) {
  const anySpec = group.fixedSpec?.unitKey ? group.fixedSpec : group.rangeSpecs?.[0];
  if (!anySpec?.unitKey) return;
  const patch: Record<string, unknown> = { [anySpec.unitKey]: newUnit.value };
  if (isRangeMode(props.range, group) && group.rangeSpecs) {
    patch[group.rangeSpecs[0].key] = newUnit.defaultStart;
    patch[group.rangeSpecs[1].key] = newUnit.defaultEnd;
  } else if (group.fixedSpec) {
    patch[group.fixedSpec.key] = newUnit.defaultFixed;
  }
  emit('patch', patch);
}

function swapRangeEnds(group: CombinedGroup) {
  if (!group.rangeSpecs) return;
  emit('patch', {
    [group.rangeSpecs[0].key]: (props.range as any)[group.rangeSpecs[1].key],
    [group.rangeSpecs[1].key]: (props.range as any)[group.rangeSpecs[0].key],
  });
}
</script>

<template>
  <div v-if="(CAPABILITY_RANGE_FIELDS[type] ?? []).length > 0" class="space-y-3 pt-1">
    <div v-for="group in combinedRangeFields(type)" :key="group.root" class="space-y-1.5">
      <div class="flex items-center gap-1.5 flex-wrap">
        <p class="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50 mr-auto">
          {{ group.label }}
        </p>
        <template v-if="(group.fixedSpec ?? group.rangeSpecs?.[0])?.unitOptions">
          <button
            v-for="unitOpt in (group.fixedSpec ?? group.rangeSpecs![0]).unitOptions" :key="unitOpt.value"
            class="px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors"
            :class="activeUnit(range, (group.fixedSpec ?? group.rangeSpecs![0]).unitKey!, (group.fixedSpec ?? group.rangeSpecs![0]).unitOptions!).value === unitOpt.value
              ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground/50 border-border/50 hover:border-border hover:text-foreground'"
            @click="changeUnit(group, unitOpt)"
          >{{ unitOpt.label }}</button>
        </template>
        <button v-if="group.fixedSpec && group.rangeSpecs" class="px-1.5 py-0.5 rounded text-[9px] font-medium border border-border/50 text-muted-foreground/50 hover:border-border hover:text-foreground" @click="toggleRangeMode(group)">
          {{ isRangeMode(range, group) ? 'Fixed' : 'Range' }}
        </button>
      </div>

      <div class="grid grid-cols-2 gap-1.5 items-center">
        <template v-if="isRangeMode(range, group) && group.rangeSpecs">
          <DraggableNumberInput :label="group.rangeSpecs[0].dragLabel ?? 'Start'" :model-value="(range as any)[group.rangeSpecs[0].key]" @update:model-value="emit('patch', { [group.rangeSpecs![0].key]: $event })" :min="group.rangeSpecs[0].min" :max="group.rangeSpecs[0].max" :step="group.rangeSpecs[0].step" />
          <div class="flex items-center gap-1.5">
            <DraggableNumberInput :label="group.rangeSpecs[1].dragLabel ?? 'End'" :model-value="(range as any)[group.rangeSpecs[1].key]" @update:model-value="emit('patch', { [group.rangeSpecs![1].key]: $event })" :min="group.rangeSpecs[1].min" :max="group.rangeSpecs[1].max" :step="group.rangeSpecs[1].step" class="flex-1" />
            <button class="text-muted-foreground/30 hover:text-foreground shrink-0" @click="swapRangeEnds(group)"><ArrowLeftRight class="size-3" /></button>
          </div>
        </template>
        <template v-else-if="group.fixedSpec">
          <DraggableNumberInput :label="group.fixedSpec.dragLabel ?? 'Value'" :model-value="(range as any)[group.fixedSpec.key]" @update:model-value="emit('patch', { [group.fixedSpec!.key]: $event })" :min="group.fixedSpec.min" :max="group.fixedSpec.max" :step="group.fixedSpec.step" class="col-span-1" />
        </template>
      </div>
    </div>
  </div>
</template>
