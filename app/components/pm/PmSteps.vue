<script setup lang="ts">
/**
 * Core default of `pm.steps` (plan M8.2): a grid with one row per group
 * (shared group colors, "Group A…") and one column per step. Click toggles a
 * cell, dragging paints the same state; "+" adds a step, right-click on a
 * column number removes that step; rows can be added/removed. The playhead
 * column is highlighted; rows beyond `activeGroups` are dimmed.
 */
import { computed, ref } from 'vue';
import type { StepsEmits, StepsProps, StepsValue } from '@pixelmapper/extension-api';
import { GROUP_COLORS, groupLetter } from '~/components/engine/distribution/group-colors';

const props = withDefaults(defineProps<StepsProps>(), { disabled: false, size: 'md', activeGroups: 0, playhead: null });
const emit = defineEmits<StepsEmits>();

const MAX_STEPS = 16;
const MAX_GROUPS = 8;
const v = computed<StepsValue>(() => props.modelValue ?? { groups: 1, steps: 1, cells: [[true]] });
const current = computed(() => (props.playhead == null ? -1 : Math.floor(props.playhead) % v.value.steps));
const paint = ref<boolean | null>(null);

/** A copy of the grid resized to `groups` × `steps` (new cells off). */
function resized(groups: number, steps: number): StepsValue {
  const cells = Array.from({ length: steps }, (_, s) => Array.from({ length: groups }, (_, g) => !!v.value.cells[s]?.[g]));
  return { groups, steps, cells };
}

/** Emits a discrete edit as one undo step. */
function commit(next: StepsValue) {
  emit('scrubStart');
  emit('update:modelValue', next);
  emit('scrubEnd');
}

/** Sets one cell (live, inside a paint stroke). */
function setCell(s: number, g: number, on: boolean) {
  if (!!v.value.cells[s]?.[g] === on) return;
  const next = resized(v.value.groups, v.value.steps);
  next.cells[s]![g] = on;
  emit('update:modelValue', next);
}

function onCellDown(e: PointerEvent, s: number, g: number) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  paint.value = !v.value.cells[s]?.[g];
  emit('scrubStart');
  setCell(s, g, paint.value);
  const up = () => {
    window.removeEventListener('pointerup', up);
    paint.value = null;
    emit('scrubEnd');
  };
  window.addEventListener('pointerup', up);
}

function onCellEnter(s: number, g: number) {
  if (paint.value !== null) setCell(s, g, paint.value);
}

function removeStep(s: number) {
  if (v.value.steps <= 1) return;
  const next = resized(v.value.groups, v.value.steps);
  next.cells.splice(s, 1);
  commit({ ...next, steps: v.value.steps - 1 });
}
</script>

<template>
  <div class="flex flex-col gap-1 min-w-0" :class="disabled && 'opacity-50 pointer-events-none'">
    <span v-if="label" class="text-xs text-muted-foreground truncate">{{ label }}</span>
    <div class="overflow-x-auto">
      <table class="border-separate border-spacing-0.5 select-none" aria-label="Steps">
        <thead>
          <tr>
            <th />
            <th
              v-for="s in v.steps" :key="s" scope="col"
              class="text-[9px] font-medium w-5 cursor-context-menu"
              :class="current === s - 1 ? 'text-primary' : 'text-muted-foreground'"
              title="Right-click to remove this step"
              :data-step-header="s - 1"
              @contextmenu.prevent="removeStep(s - 1)"
            >
              {{ s }}
            </th>
            <th>
              <button type="button" class="w-5 h-4 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Add step" :disabled="v.steps >= MAX_STEPS" data-add-step @click="commit(resized(v.groups, v.steps + 1))">+</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in v.groups" :key="g" :class="activeGroups > 0 && g > activeGroups && 'opacity-40'">
            <th scope="row" class="pr-1 text-left text-[9px] font-medium whitespace-nowrap" :style="{ color: GROUP_COLORS[(g - 1) % GROUP_COLORS.length] }">Group {{ groupLetter(g - 1) }}</th>
            <td v-for="s in v.steps" :key="s" class="p-0">
              <div
                class="w-5 h-4 rounded-sm border cursor-pointer"
                :class="current === s - 1 ? 'border-primary' : 'border-border/50'"
                :style="{ background: v.cells[s - 1]?.[g - 1] ? GROUP_COLORS[(g - 1) % GROUP_COLORS.length] : 'transparent' }"
                role="checkbox" :aria-checked="!!v.cells[s - 1]?.[g - 1]" :data-cell="`${s - 1}:${g - 1}`"
                @pointerdown="e => onCellDown(e, s - 1, g - 1)"
                @pointerenter="onCellEnter(s - 1, g - 1)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="flex gap-2 text-[10px] text-muted-foreground">
      <button type="button" class="hover:text-foreground disabled:opacity-30" :disabled="v.groups >= MAX_GROUPS" data-add-group @click="commit(resized(v.groups + 1, v.steps))">+ Group</button>
      <button type="button" class="hover:text-foreground disabled:opacity-30" :disabled="v.groups <= 1" @click="commit(resized(v.groups - 1, v.steps))">− Group</button>
    </div>
  </div>
</template>
