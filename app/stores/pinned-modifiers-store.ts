import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Effect } from '~/utils/engine/types';
import type { PresetModifierSnapshot } from '~/utils/engine/preset-types';
import { snapshotEffect } from '~/components/engine/composables/preset-helpers';
import { reconstructEffect } from '~/components/engine/composables/preset-apply';

export interface PinnedModifier {
  id: string;
  effectId: string;
  name: string;
  snapshot: PresetModifierSnapshot;
}

function autoName(snap: PresetModifierSnapshot): string {
  if (snap.effectType === 'ColorEffect') {
    const hs = snap.colorParams?.hueShift ?? 0;
    const sat = snap.colorParams?.saturation ?? 1;
    if (sat <= 0.05) return 'Grayscale';
    if (Math.abs(hs) > 5) return `Hue +${Math.round(hs)}°`;
    return 'Color Adjust';
  }
  if (snap.effectType === 'SequencerEffect') {
    const pt = snap.sequencerParams?.patternType ?? 'split';
    const labels: Record<string, string> = {
      split: 'Split Pattern', checkerboard: 'Checkerboard', sections: 'Sections',
      scatter: 'Scatter', flow: 'Flow',
    };
    return labels[pt] ?? 'Sequencer';
  }
  if (snap.effectType === 'NoiseEffect') {
    const nt = snap.noiseParams?.noiseType ?? 'white';
    const labels: Record<string, string> = { white: 'White Noise', perlin: 'Perlin Noise', step: 'Step Noise' };
    return labels[nt] ?? 'Noise';
  }
  const shape = snap.waveformShape ?? 'sine';
  const labels: Record<string, string> = {
    sine: 'Sine Wave', square: 'Square Wave', triangle: 'Triangle Wave',
    sawtooth: 'Sawtooth Wave', bounce: 'Bounce Wave', ramp: 'Ramp Wave', smooth: 'Smooth Wave',
  };
  return labels[shape] ?? 'Waveform';
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

export const usePinnedModifiersStore = defineStore('pinned-modifiers', () => {
  const pinnedModifiers = ref<PinnedModifier[]>([]);

  function pinModifier(effect: Effect) {
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

  function applyPinnedModifier(snapshot: PresetModifierSnapshot): Effect | null {
    const eff = reconstructEffect(snapshot);
    if (eff) eff.id = newId();
    return eff;
  }

  return { pinnedModifiers, pinModifier, unpinModifier, isPinned, applyPinnedModifier };
});
