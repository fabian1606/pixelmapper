import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { pressButton, releaseButton } from '~/composables/live-ops/button-runtime';
import { sectionPress, sectionRelease } from '~/composables/live-ops/use-section-binding';
import { emitWidgetTriggerLocal } from '~/composables/live-ops/live-widget-ops';
import { onMidiInput } from '~/composables/live-ops/midi-input';
import { midiMatches, parseMidiInput } from '~/utils/live/button-actions';
import type { ButtonAction, ButtonInputs } from '~/utils/live/types';

/** A button or pad on the active page that has keyboard / MIDI inputs. */
interface InputTarget {
  pageId: string;
  widgetId: string;
  controlId?: string;
  actions?: ButtonAction[];
  inputs: ButtonInputs;
}

/** Focus is in a text field: keys belong to the field, not to buttons. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Keyboard keys and MIDI messages press the buttons / pads they are assigned
 * to (Input group of the button panel), exactly like a click or a pad hit: down presses,
 * up releases. So every trigger works with them (While pressing, long press,
 * toggle, …), and section members press their section slot. Play mode only.
 * Mount once in the live page; MIDI is only opened while some button uses it.
 */
export function useButtonInputTriggers() {
  const store = useLiveModeStore();
  const liveBus = useLiveBusStore();

  const targets = computed<InputTarget[]>(() => {
    const page = store.activePage;
    if (!page) return [];
    const out: InputTarget[] = [];
    for (const w of page.widgets) {
      if (w.type === 'button' && (w.inputs?.key || w.inputs?.midi)) {
        out.push({ pageId: page.id, widgetId: w.id, actions: w.actions, inputs: w.inputs });
      }
      for (const c of w.controllerChildren ?? []) {
        if (c.inputs?.key || c.inputs?.midi) {
          out.push({ pageId: page.id, widgetId: w.id, controlId: c.controlId, actions: c.actions, inputs: c.inputs });
        }
      }
    }
    return out;
  });

  /** Press or release one target: section slot first, otherwise its actions; plus the pressed look. */
  function setPressed(t: InputTarget, down: boolean) {
    const key = t.controlId ? `${t.widgetId}::${t.controlId}` : t.widgetId;
    const ref = { widgetId: t.widgetId, controlId: t.controlId };
    if (down) {
      if (!sectionPress(ref)) pressButton(t.actions, { key });
    } else if (!sectionRelease(ref)) {
      releaseButton(t.actions, { key });
    }
    emitWidgetTriggerLocal(t.pageId, t.widgetId, down, t.controlId);
    liveBus.dispatch('widget.trigger', { pageId: t.pageId, widgetId: t.widgetId, active: down, controlId: t.controlId });
  }

  // Keys currently held down, so key-up releases exactly what key-down pressed.
  const heldKeys = new Map<string, InputTarget[]>();

  function onKeyDown(e: KeyboardEvent) {
    // Modifier combos stay with the app shortcuts (undo, copy, …).
    if (store.editMode || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const hit = targets.value.filter(t => t.inputs.key === e.code);
    if (hit.length === 0) return;
    e.preventDefault();
    heldKeys.set(e.code, hit);
    for (const t of hit) setPressed(t, true);
  }

  function onKeyUp(e: KeyboardEvent) {
    const hit = heldKeys.get(e.code);
    if (!hit) return;
    heldKeys.delete(e.code);
    for (const t of hit) setPressed(t, false);
  }

  /** Window lost focus: key-up never arrives, so release everything held. */
  function onBlur() {
    for (const hit of heldKeys.values()) for (const t of hit) setPressed(t, false);
    heldKeys.clear();
  }

  function onMidi(data: Uint8Array) {
    if (store.editMode) return;
    const msg = parseMidiInput(data);
    if (!msg) return;
    for (const t of targets.value) {
      if (midiMatches(t.inputs.midi, msg.message)) setPressed(t, msg.down);
    }
  }

  // Open MIDI only while a button listens for it (avoids a needless permission prompt).
  const usesMidi = computed(() => targets.value.some(t => t.inputs.midi));
  let offMidi: (() => void) | null = null;
  watch(usesMidi, (on) => {
    if (on && !offMidi) offMidi = onMidiInput(onMidi);
    if (!on && offMidi) { offMidi(); offMidi = null; }
  }, { immediate: true });

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    onBlur();
    offMidi?.();
    offMidi = null;
  });
}
