import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { pressButton, releaseButton } from '~/composables/live-ops/button-runtime';
import { sectionPress, sectionRelease } from '~/composables/live-ops/use-section-binding';
import { emitWidgetTriggerLocal } from '~/composables/live-ops/live-widget-ops';
import { bindingKey, getInputSource } from '~/utils/live/inputs/registry';
import type { InputSignal } from '~/utils/live/inputs/types';
import type { ButtonAction, InputBinding } from '~/utils/live/types';

/** A button or pad on the active page that an input binding presses. */
interface InputTarget {
  pageId: string;
  widgetId: string;
  controlId?: string;
  actions?: ButtonAction[];
}

/**
 * Input bindings (keys, MIDI, … — any registered `InputSource`) press the
 * buttons / pads they are assigned to, exactly like a click or a pad hit:
 * down presses, up releases. So every trigger works with them (While
 * pressing, long press, toggle, …), and section members press their section
 * slot. Play mode only. Mount once in the live page; a source is only
 * listened to while some button uses it (no needless MIDI permission prompt).
 * Input a controller owns belongs to its twin and is ignored here.
 */
export function useButtonInputTriggers() {
  const store = useLiveModeStore();
  const liveBus = useLiveBusStore();

  /** Binding key → the buttons / pads it presses, plus the sources in use. */
  const index = computed(() => {
    const targets = new Map<string, InputTarget[]>();
    const sources = new Set<string>();
    const page = store.activePage;
    if (!page) return { targets, sources };
    const add = (inputs: InputBinding[] | undefined, t: InputTarget) => {
      // Older data stored `{ key, midi }`; not a list → ignored (no migration).
      if (!Array.isArray(inputs)) return;
      for (const b of inputs) {
        const key = bindingKey(b);
        targets.set(key, [...(targets.get(key) ?? []), t]);
        sources.add(b.source);
      }
    };
    for (const w of page.widgets) {
      if (w.type === 'button') add(w.inputs, { pageId: page.id, widgetId: w.id, actions: w.actions });
      for (const c of w.controllerChildren ?? []) {
        add(c.inputs, { pageId: page.id, widgetId: w.id, controlId: c.controlId, actions: c.actions });
      }
    }
    return { targets, sources };
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

  // Bindings currently held, so the release hits exactly what the press hit.
  const held = new Map<string, InputTarget[]>();

  /** Signal from any source; returns whether it pressed / released something. */
  function onSignal(signal: InputSignal): boolean {
    if (signal.ownedBy) return false;
    const key = bindingKey(signal.binding);
    if (signal.down) {
      if (store.editMode || held.has(key)) return false;
      const hit = index.value.targets.get(key);
      if (!hit) return false;
      held.set(key, hit);
      for (const t of hit) setPressed(t, true);
      return true;
    }
    const hit = held.get(key);
    if (!hit) return false;
    held.delete(key);
    for (const t of hit) setPressed(t, false);
    return true;
  }

  /** Window lost focus: releases may never arrive, so release everything held. */
  function releaseAll() {
    for (const hit of held.values()) for (const t of hit) setPressed(t, false);
    held.clear();
  }

  // One listener per source in use, opened / closed as bindings change.
  const stops = new Map<string, () => void>();
  watch(() => index.value.sources, (ids) => {
    for (const [id, stop] of stops) {
      if (!ids.has(id)) { stop(); stops.delete(id); }
    }
    for (const id of ids) {
      const source = getInputSource(id);
      if (!stops.has(id) && source?.isAvailable()) stops.set(id, source.listen('play', onSignal));
    }
  }, { immediate: true });

  onMounted(() => window.addEventListener('blur', releaseAll));
  onUnmounted(() => {
    window.removeEventListener('blur', releaseAll);
    releaseAll();
    for (const stop of stops.values()) stop();
    stops.clear();
  });
}
