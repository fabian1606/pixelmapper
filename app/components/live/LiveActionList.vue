<script setup lang="ts">
import { computed } from 'vue';
import { Plus } from 'lucide-vue-next';
import type { ButtonAction } from '~/utils/live/types';
import { newButtonAction } from '~/utils/live/button-actions';
import { Button } from '@/components/ui/button';
import LiveActionCard from './LiveActionCard.vue';

/**
 * A button's script: one always-open card per action and "Add Action" after
 * the last one (like "Create Preset" / "Add Modifier"). A button always has at
 * least one action: an empty list shows the default "On press" card, which is
 * stored as soon as it is edited, and the last card cannot be deleted. Emits
 * the full new list so the caller persists it as one history step.
 */
const props = defineProps<{
  actions: ButtonAction[];
}>();

const emit = defineEmits<{
  (e: 'update', actions: ButtonAction[]): void;
}>();

// Stable placeholder for buttons without stored actions (older buttons).
const placeholder = newButtonAction();
const shown = computed(() => (props.actions.length ? props.actions : [placeholder]));

function updateAt(index: number, action: ButtonAction) {
  emit('update', shown.value.map((a, i) => (i === index ? action : a)));
}

function removeAt(index: number) {
  if (shown.value.length <= 1) return;
  emit('update', shown.value.filter((_, i) => i !== index));
}

function add() {
  emit('update', [...shown.value, newButtonAction()]);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <LiveActionCard
      v-for="(a, i) in shown"
      :key="a.id"
      :action="a"
      :removable="shown.length > 1"
      @update="(next) => updateAt(i, next)"
      @remove="removeAt(i)"
    />

    <div class="flex justify-center">
      <Button
        variant="outline"
        class="h-7 text-[10px] uppercase tracking-widest font-semibold gap-1.5"
        @click="add"
      >
        <Plus class="size-3" />
        Add Action
      </Button>
    </div>
  </div>
</template>
