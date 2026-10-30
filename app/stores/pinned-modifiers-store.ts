import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import { modifierName, newModifierId } from '~/utils/engine/modifiers';
import { snapshotEffect } from '~/components/engine/composables/preset-helpers';
import { reconstructEffect } from '~/components/engine/composables/preset-apply';

export interface PinnedModifier {
  id: string;
  effectId: string;
  name: string;
  snapshot: ModifierInstance;
}

/** Name shown for a pinned modifier: plugin name + first enum param label. */
function autoName(snap: ModifierInstance): string {
  return modifierName(snap);
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

export const usePinnedModifiersStore = defineStore('pinned-modifiers', () => {
  const pinnedModifiers = ref<PinnedModifier[]>([]);

  function pinModifier(effect: ModifierInstance) {
    const snapshot = snapshotEffect(effect);
    pinnedModifiers.value.push({
      id: newId(),
      effectId: effect.id,
      name: autoName(snapshot),
      snapshot,
    });
  }

  function unpinModifier(effectId: string) {
    const idx = pinnedModifiers.value.findIndex(p => p.effectId === effectId);
    if (idx >= 0) pinnedModifiers.value.splice(idx, 1);
  }

  function isPinned(effectId: string): boolean {
    return pinnedModifiers.value.some(p => p.effectId === effectId);
  }

  function applyPinnedModifier(snapshot: ModifierInstance): ModifierInstance | null {
    const eff = reconstructEffect(snapshot);
    // Always a fresh instance id: the pinned snapshot can be added many times.
    if (eff) eff.id = newModifierId();
    return eff;
  }

  return { pinnedModifiers, pinModifier, unpinModifier, isPinned, applyPinnedModifier };
});
