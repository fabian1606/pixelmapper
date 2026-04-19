import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import type { Preset, PresetModifierSnapshot } from '~/utils/engine/preset-types';
import { WaveformEffect } from '~/utils/engine/effects/waveform-effect';
import { getCategoryType, getEffectCategoryType } from './preset-helpers';

// ─── Reset ────────────────────────────────────────────────────────────────────

/** Resets all channels on the given fixtures back to their default values. */
export function resetFixtureChannels(fixtures: Fixture[]): void {
  for (const fixture of fixtures) {
    for (const ch of fixture.channels) {
      ch.chaserConfig.stepValues = [ch.defaultValue];
      ch.chaserConfig.stepsCount = 1;
      ch.chaserConfig.activeEditStep = 0;
      ch.chaserConfig.isPlaying = false;
      ch.currentBaseValue = ch.defaultValue;
    }
  }
}

// ─── Effect reconstruction ────────────────────────────────────────────────────

/** Reconstructs a live Effect instance from a saved PresetModifierSnapshot. */
export function reconstructEffect(snap: PresetModifierSnapshot): Effect | null {
  // Support both legacy 'SineEffect' and new 'WaveformEffect' snapshot types
  if (snap.effectType === 'SineEffect' || snap.effectType === 'WaveformEffect') {
    const eff = new WaveformEffect();
    eff.id = snap.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11));
    eff.targetChannels = [...snap.targetChannels];
    eff.targetFixtureIds = [...snap.targetFixtureIds];
    eff.strength = snap.strength;
    eff.fanning = snap.fanning;
    eff.speed = { ...snap.speed };
    eff.direction = snap.direction ?? 'LINEAR';
    eff.reverse = snap.reverse ?? false;
    eff.originX = snap.originX ?? 0.5;
    eff.originY = snap.originY ?? 0.5;
    eff.angle = snap.angle ?? 0;
    eff.waveformShape = snap.waveformShape ?? 'sine';
    eff.waveformParams = snap.waveformParams ? { ...snap.waveformParams } : { param: 0.5, start: 0, end: 1 };
    return eff;
  }
  return null;
}

// ─── Internal apply helpers ───────────────────────────────────────────────────

/** Removes all effects that target any fixture that the preset controls. */
function clearPresetEffects(preset: Preset, effects: Effect[]): void {
  const allPresetFixtureIds = new Set(preset.categories.flatMap((c) => c.fixtureIds));
  for (let i = effects.length - 1; i >= 0; i--) {
    const eff = effects[i];
    if (eff?.targetFixtureIds?.some((id) => allPresetFixtureIds.has(id))) {
      effects.splice(i, 1);
    }
  }
}

/** Applies channel snapshots and reconstructs modifier effects from a preset. */
function applyPresetToFixtures(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  clearPresetEffects(preset, effects);

  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      for (const snap of category.channels) {
        const ch = fixture.channels[snap.channelIndex];
        if (!ch || ch.type !== snap.channelType) continue; // sanity check
        ch.chaserConfig.stepValues = [...snap.stepValues];
        ch.chaserConfig.stepsCount = snap.chaserConfig?.stepsCount ?? snap.stepValues.length;
        ch.chaserConfig.activeEditStep = snap.chaserConfig?.activeEditStep ?? 0;
        ch.chaserConfig.isPlaying = snap.chaserConfig?.isPlaying ?? false;
        if (snap.chaserConfig?.stepDuration) ch.chaserConfig.stepDuration = { ...snap.chaserConfig.stepDuration };
        if (snap.chaserConfig?.fadeDuration) ch.chaserConfig.fadeDuration = { ...snap.chaserConfig.fadeDuration };
        ch.currentBaseValue = snap.stepValues[0] ?? ch.defaultValue;
      }
    }

    // Restore modifier effects; assign target fixture IDs from the category
    for (const modSnap of category.modifiers) {
      const eff = reconstructEffect(modSnap);
      if (eff) {
        eff.targetFixtureIds = [...category.fixtureIds];
        effects.push(eff);
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Applies a preset: clears relevant channels/effects for the preset's
 * fixture-category pairs, then restores values and modifier effects.
 */
export function applyPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  // Clear only the category/fixture pairs this preset controls
  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      for (const ch of fixture.channels) {
        if (getCategoryType(ch.type) === category.type) {
          ch.chaserConfig.stepValues = [ch.defaultValue];
          ch.chaserConfig.stepsCount = 1;
          ch.chaserConfig.activeEditStep = 0;
          ch.chaserConfig.isPlaying = false;
          ch.currentBaseValue = ch.defaultValue;
        }
      }
    }

    // Remove effects targeting these fixtures in this category
    for (let i = effects.length - 1; i >= 0; i--) {
      const eff = effects[i];
      if (!eff) continue;
      if (getEffectCategoryType(eff) === category.type && eff.targetFixtureIds) {
        eff.targetFixtureIds = eff.targetFixtureIds.filter(
          (id) => !category.fixtureIds.includes(id as string | number)
        );
        if (eff.targetFixtureIds.length === 0) effects.splice(i, 1);
      }
    }
  }

  applyPresetToFixtures(preset, fixtures, effects);
}

/**
 * Stops a preset: reverts channels to default and removes modifier effects
 * that were applied by this preset.
 */
export function stopPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      for (const snap of category.channels) {
        const ch = fixture.channels[snap.channelIndex];
        if (!ch || ch.type !== snap.channelType) continue; // sanity check
        ch.chaserConfig.stepValues = [ch.defaultValue];
        ch.chaserConfig.stepsCount = 1;
        ch.chaserConfig.activeEditStep = 0;
        ch.chaserConfig.isPlaying = false;
        ch.currentBaseValue = ch.defaultValue;
      }
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const eff = effects[i];
      if (!eff) continue;
      if (getEffectCategoryType(eff) === category.type && eff.targetFixtureIds) {
        eff.targetFixtureIds = eff.targetFixtureIds.filter(
          (id) => !category.fixtureIds.includes(id as string | number)
        );
        if (eff.targetFixtureIds.length === 0) effects.splice(i, 1);
      }
    }
  }
}
