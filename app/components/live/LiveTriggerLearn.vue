<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { MidiTrigger } from '~/utils/live/types';
import { keyLabel, midiLabel, parseMidiInput } from '~/utils/live/button-actions';
import { isMidiAvailable, onMidiInput } from '~/composables/live-ops/midi-input';
import { X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

/**
 * Shows the key / MIDI message that presses a button, with "Learn": press a
 * key (or play a note / move a control) and it is stored. Escape cancels;
 * the × clears the assignment.
 */
const props = defineProps<{
  kind: 'key' | 'midi';
  keyCode?: string;
  midi?: MidiTrigger;
}>();

const emit = defineEmits<{
  (e: 'update:keyCode', code: string | undefined): void;
  (e: 'update:midi', midi: MidiTrigger | undefined): void;
}>();

const learning = ref(false);
const midiAvailable = isMidiAvailable();

const display = computed(() => {
  if (learning.value) return props.kind === 'key' ? 'Press a key…' : 'Play a note or move a control…';
  if (props.kind === 'key') return props.keyCode ? keyLabel(props.keyCode) : 'No key';
  return props.midi ? midiLabel(props.midi) : 'No MIDI message';
});

let stopLearning: (() => void) | null = null;

function onLearnKey(e: KeyboardEvent) {
  // Capture phase + stop: the learned key must not reach the app shortcuts.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code !== 'Escape') emit('update:keyCode', e.code);
  cancel();
}

function learn() {
  if (learning.value) { cancel(); return; }
  learning.value = true;
  if (props.kind === 'key') {
    window.addEventListener('keydown', onLearnKey, { capture: true });
    stopLearning = () => window.removeEventListener('keydown', onLearnKey, { capture: true });
  } else {
    const off = onMidiInput((data) => {
      const msg = parseMidiInput(data);
      if (!msg?.down) return;
      emit('update:midi', msg.message);
      cancel();
    });
    stopLearning = off;
  }
}

function clear() {
  cancel();
  if (props.kind === 'key') emit('update:keyCode', undefined);
  else emit('update:midi', undefined);
}

function cancel() {
  learning.value = false;
  stopLearning?.();
  stopLearning = null;
}

onUnmounted(cancel);
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-[9px] uppercase tracking-wider text-muted-foreground/60">{{ kind === 'key' ? 'Key' : 'MIDI' }}</span>
    <p v-if="kind === 'midi' && !midiAvailable" class="text-[10px] text-muted-foreground/70 leading-snug">
      MIDI is not available in this browser. Use Chrome, Edge or the desktop app.
    </p>
    <div v-else class="flex items-center gap-1">
      <div
        class="flex-1 min-w-0 h-8 flex items-center px-2 rounded-md border text-xs font-mono truncate"
        :class="learning
          ? 'border-primary text-primary bg-primary/10'
          : (keyCode || midi) ? 'border-border bg-background' : 'border-border border-dashed text-muted-foreground bg-muted/30'"
      >
        {{ display }}
      </div>
      <Button variant="outline" class="h-8 px-2.5 text-xs shrink-0" @click="learn">
        {{ learning ? 'Cancel' : 'Learn' }}
      </Button>
      <Button
        v-if="!learning && (kind === 'key' ? keyCode : midi)"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title="Remove"
        @click="clear"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>
  </div>
</template>
