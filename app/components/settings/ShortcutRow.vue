<script setup lang="ts">
/**
 * One shortcut in Settings → Shortcuts: its keys as chips. Click a chip to
 * re-record it, + to add a key, × to remove one, ↺ to restore the defaults.
 * While recording, keydowns are swallowed (capture phase) so they neither
 * trigger app shortcuts nor close the dialog; Esc cancels.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { ShortcutDef, ShortcutId } from '~/utils/shortcuts/shortcut-registry';
import { bindingFromEvent, formatBinding } from '~/utils/shortcuts/key-binding';
import { assignBinding, getBindings, isCustomized, resetBindings, setBindings } from '~/composables/use-shortcut-bindings';
import { Plus, RotateCcw, X } from 'lucide-vue-next';

const props = defineProps<{ def: ShortcutDef }>();

const id = computed(() => props.def.id as ShortcutId);
const keys = computed(() => getBindings(id.value));

/** Chip being recorded: its index, `'new'` for +, `null` when idle. */
const recording = ref<number | 'new' | null>(null);
/** Shortcuts the last assignment took its key from. */
const note = ref('');

function onKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'Escape') return stop();
  const binding = bindingFromEvent(e);
  if (!binding) return; // only modifiers held so far
  const takenFrom = assignBinding(id.value, binding, recording.value === 'new' ? null : recording.value);
  note.value = takenFrom.length ? `Removed from ${takenFrom.join(', ')}` : '';
  stop();
}

function record(target: number | 'new') {
  stop();
  note.value = '';
  recording.value = target;
  window.addEventListener('keydown', onKey, { capture: true });
  // Clicking anywhere else cancels (after the click that started recording).
  setTimeout(() => window.addEventListener('pointerdown', stop, { capture: true, once: true }));
}

function stop() {
  recording.value = null;
  window.removeEventListener('keydown', onKey, { capture: true });
  window.removeEventListener('pointerdown', stop, { capture: true });
}

function remove(index: number) {
  note.value = '';
  setBindings(id.value, keys.value.filter((_, i) => i !== index));
}

onBeforeUnmount(stop);
</script>

<template>
  <div class="flex items-start justify-between gap-3 py-1.5">
    <div class="flex flex-col pt-1 min-w-0">
      <span class="text-xs">{{ def.label }}</span>
      <span v-if="note" class="text-[10px] text-muted-foreground">{{ note }}</span>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-1">
      <span
        v-for="(binding, i) in keys"
        :key="i"
        class="group/chip relative inline-flex items-center"
      >
        <button
          type="button"
          class="h-6 min-w-8 rounded border px-1.5 font-mono text-[11px] transition-colors"
          :class="recording === i ? 'border-primary text-primary animate-pulse' : 'border-border bg-muted hover:border-foreground/40'"
          title="Click to change"
          @click="record(i)"
        >
          {{ recording === i ? 'Press keys…' : formatBinding(binding) }}
        </button>
        <button
          v-if="recording !== i"
          type="button"
          class="absolute -right-1.5 -top-1.5 hidden size-3.5 items-center justify-center rounded-full bg-foreground text-background group-hover/chip:flex"
          title="Remove"
          @click.stop="remove(i)"
        >
          <X class="size-2.5" />
        </button>
      </span>
      <span v-if="keys.length === 0 && recording !== 'new'" class="px-1 text-[11px] text-muted-foreground">—</span>
      <button
        type="button"
        class="h-6 rounded border border-dashed px-1.5 text-[11px] transition-colors"
        :class="recording === 'new' ? 'border-primary text-primary animate-pulse' : 'border-border text-muted-foreground hover:text-foreground'"
        title="Add a key"
        @click="record('new')"
      >
        <template v-if="recording === 'new'">Press keys…</template>
        <Plus v-else class="size-3" />
      </button>
      <button
        type="button"
        class="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
        :class="{ invisible: !isCustomized(id) }"
        title="Restore default"
        @click="resetBindings(id); note = ''"
      >
        <RotateCcw class="size-3" />
      </button>
    </div>
  </div>
</template>
