<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { InputBinding } from '~/utils/live/types';
import { bindingKey, bindingLabel, learnPrompt, listInputSources } from '~/utils/live/inputs/registry';
import type { InputSignal } from '~/utils/live/inputs/types';
import { useGlobalContextMenu } from '~/composables/useGlobalContextMenu';
import { Plus, Trash2, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

/**
 * Input group of the button panel: the outside inputs that press a button.
 * "+" in the heading learns a new one from whatever source fires first (key,
 * MIDI, any registered `InputSource`); clicking a row re-learns it. The ×
 * on hover, Backspace / Delete on a focused row or the context menu remove
 * it. Escape or a click elsewhere cancels learning.
 *
 * `native` is what a controller pad already is in hardware (e.g. its MIDI
 * note): shown read-only on top. Input a controller owns can't be learned.
 */
const props = defineProps<{
  inputs?: InputBinding[];
  /** Hardware address of a controller pad (read-only). */
  native?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update', inputs: InputBinding[]): void;
}>();

const { openMenu } = useGlobalContextMenu();

// Older data stored `{ key, midi }`; not a list → treated as empty.
const list = computed(() => (Array.isArray(props.inputs) ? props.inputs : []));

/** Row being learned: its index, `'new'` for +, `null` when idle. */
const learning = ref<number | 'new' | null>(null);
/** Shown while learning after input a controller owns arrived. */
const hint = ref<string | null>(null);

const prompt = computed(() => learnPrompt());

let stops: (() => void)[] = [];

function onSignal(signal: InputSignal): boolean {
  if (!signal.down || learning.value === null) return false;
  if (signal.ownedBy) {
    hint.value = `That is the ${signal.ownedBy}. Add its twin and set the control up there.`;
    return false;
  }
  const key = bindingKey(signal.binding);
  const target = learning.value;
  const others = list.value.filter((b, i) => i !== target && bindingKey(b) !== key);
  // Re-learned rows keep their place; new ones go last. Duplicates collapse.
  const next = typeof target === 'number'
    ? [...others.slice(0, target), signal.binding, ...others.slice(target)]
    : [...others, signal.binding];
  emit('update', next);
  stop();
  return true;
}

/** Escape cancels; swallowed so it neither deselects nor closes anything. */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  stop();
}

function learn(target: number | 'new') {
  const same = learning.value === target;
  stop();
  if (same) return;
  learning.value = target;
  stops = listInputSources()
    .filter(s => s.isAvailable())
    .map(s => s.listen('learn', onSignal));
  window.addEventListener('keydown', onKey, { capture: true });
  // Clicking anywhere else cancels (after the click that started learning).
  setTimeout(() => window.addEventListener('pointerdown', onPointerDown, { capture: true }));
}

function onPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement | null)?.closest('[data-input-learn]')) return;
  stop();
}

function stop() {
  learning.value = null;
  hint.value = null;
  for (const s of stops) s();
  stops = [];
  window.removeEventListener('keydown', onKey, { capture: true });
  window.removeEventListener('pointerdown', onPointerDown, { capture: true });
}

/** Drops one binding. */
function remove(index: number) {
  stop();
  emit('update', list.value.filter((_, i) => i !== index));
}

function onRowMenu(e: MouseEvent, index: number) {
  openMenu(e, [{
    label: 'Remove Input',
    icon: Trash2,
    variant: 'destructive',
    action: () => remove(index),
  }]);
}

/** Backspace / Delete on a focused row removes it (not the selected widget). */
function onRowKey(e: KeyboardEvent, index: number) {
  if (learning.value !== null || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
  e.preventDefault();
  e.stopPropagation();
  remove(index);
}

onUnmounted(stop);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Input</span>
      <Button
        data-input-learn
        variant="ghost"
        size="icon"
        class="size-6 text-muted-foreground hover:text-foreground"
        :class="{ 'text-primary': learning === 'new' }"
        title="Learn an input"
        @click="learn('new')"
      >
        <Plus class="size-3.5" />
      </Button>
    </div>

    <!-- Controller pad: what it already sends -->
    <div
      v-if="native"
      class="h-8 flex items-center px-2 rounded-md border border-border bg-muted/30 text-xs font-mono text-muted-foreground truncate"
      title="Sent by the controller itself"
    >
      {{ native }}
    </div>

    <div
      v-for="(binding, i) in list"
      :key="bindingKey(binding)"
      class="group/input relative"
    >
      <button
        data-input-learn
        type="button"
        class="w-full h-8 flex items-center pl-2 pr-8 rounded-md border text-xs font-mono text-left truncate transition-colors"
        :class="learning === i ? 'border-primary text-primary bg-primary/10' : 'border-border bg-background hover:border-foreground/40'"
        title="Click to learn again"
        @click="learn(i)"
        @keydown="onRowKey($event, i)"
        @contextmenu.prevent="onRowMenu($event, i)"
      >
        {{ learning === i ? prompt : bindingLabel(binding) }}
      </button>
      <!-- Remove: shown on hover / focus, like the shortcut chips in Settings -->
      <button
        v-if="learning !== i"
        type="button"
        class="absolute right-1 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-destructive/10 focus-visible:opacity-100 group-hover/input:opacity-100 group-focus-within/input:opacity-100"
        title="Remove input"
        @click.stop="remove(i)"
      >
        <X class="size-3.5" />
      </button>
    </div>

    <button
      v-if="learning === 'new'"
      data-input-learn
      type="button"
      class="h-8 flex items-center px-2 rounded-md border border-primary text-primary bg-primary/10 text-xs font-mono text-left truncate"
      @click="stop()"
    >
      {{ prompt }}
    </button>
    <p v-else-if="list.length === 0 && !native" class="text-[10px] text-muted-foreground/70 leading-snug">
      No input. + learns a key, MIDI note, …
    </p>

    <p v-if="hint" class="text-[10px] text-amber-400/90 leading-snug">{{ hint }}</p>
  </div>
</template>
