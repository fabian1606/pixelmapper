<script setup lang="ts">
import { computed } from 'vue';
import { Trash2 } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import type { ActionDuration, ButtonAction, ButtonTrigger, HoldTime, LiveMapping } from '~/utils/live/types';
import { DEFAULT_HOLD, TRIGGER_LABELS, durationModesFor, effectiveDuration, withMapping } from '~/utils/live/button-actions';
import { Button } from '@/components/ui/button';
import MappingEditor from './MappingEditor.vue';
import LiveDurationInput from './LiveDurationInput.vue';
import { TRIGGER_ICONS } from './action-icons';

/**
 * One action of a button, laid out like a modifier card: the header holds
 * the trigger (when it fires) and delete; the body holds what happens and,
 * only when it can be changed, how long it lasts.
 */
const props = defineProps<{
  action: ButtonAction;
  /** False for a button's only action: a button always keeps one. */
  removable: boolean;
}>();

const emit = defineEmits<{
  (e: 'update', action: ButtonAction): void;
  (e: 'remove'): void;
}>();

const engineStore = useEngineStore();

const durationModes = computed(() => durationModesFor(props.action));
const TriggerIcon = computed(() => TRIGGER_ICONS[props.action.trigger]);

function setTrigger(trigger: ButtonTrigger) {
  emit('update', { ...props.action, trigger, triggerTouched: true });
}

function setMapping(mapping: LiveMapping) {
  // Smart default: the trigger follows the action until the user picked one.
  emit('update', withMapping(props.action, mapping, engineStore.savedPresets));
}

function setDuration(duration: ActionDuration) {
  emit('update', { ...props.action, duration });
}

function setHold(hold: HoldTime) {
  emit('update', { ...props.action, hold });
}
</script>

<template>
  <div class="border border-border/60 rounded-lg bg-card shadow-sm overflow-hidden flex flex-col">
    <!-- Header: trigger + delete (like ModifierCardHeader) -->
    <div class="flex items-center gap-1 pl-3 pr-1 py-1 border-b border-border/60 bg-muted/20 min-w-0">
      <component :is="TriggerIcon" class="size-3.5 shrink-0 text-primary" />
      <select
        class="flex-1 min-w-0 h-7 text-xs font-medium bg-transparent border border-transparent hover:border-border rounded px-1 cursor-pointer"
        :value="action.trigger"
        aria-label="Trigger"
        @change="(e) => setTrigger((e.target as HTMLSelectElement).value as ButtonTrigger)"
      >
        <option v-for="(label, key) in TRIGGER_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <Button
        v-if="removable"
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title="Delete action"
        @click="emit('remove')"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>

    <div class="p-3 flex flex-col gap-3">
      <!-- Long press: how long to hold (beats or time, never forever) -->
      <div v-if="action.trigger === 'long'" class="flex flex-col gap-1">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Hold for</span>
        <LiveDurationInput
          :model-value="action.hold ?? DEFAULT_HOLD"
          :modes="['time', 'beats']"
          @update:model-value="(v) => setHold(v as HoldTime)"
        />
      </div>

      <MappingEditor
        :mapping="action.action"
        variant="button"
        @patch="(p: { mapping: LiveMapping }) => setMapping(p.mapping)"
      />

      <!-- Duration only when it can be changed -->
      <div v-if="durationModes.length" class="flex flex-col gap-1">
        <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">Duration</span>
        <LiveDurationInput
          :model-value="effectiveDuration(action)"
          :modes="durationModes"
          @update:model-value="(v) => setDuration(v as ActionDuration)"
        />
      </div>
    </div>
  </div>
</template>
