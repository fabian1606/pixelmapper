import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import { cloneModifier, newModifierId } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { RGB } from '~/utils/live/color-utils';
import { recolorPreset } from '~/utils/live/preset-recolor';
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

/**
 * Recreates a live modifier from a preset/pinned snapshot (deep copy). It
 * keeps the snapshot's id (so the preset diff matches it to its saved
 * counterpart) unless the snapshot has none or the id is in `takenIds`
 * (already used by a live instance): then it gets a fresh id, so two live
 * instances never share one. Returns null for unknown plugins.
 */
export function reconstructEffect(snap: ModifierInstance, takenIds?: ReadonlySet<string>): ModifierInstance | null {
  if (!snap?.plugin || !getManifest(snap.plugin)) return null;
  const m = cloneModifier(snap);
  if (!m.id || takenIds?.has(m.id)) m.id = newModifierId();
  m.targetFixtureIds = [...(snap.targetFixtureIds ?? [])];
  return m;
}

// ─── Internal apply helpers ───────────────────────────────────────────────────

/** Removes all effects that target any fixture that the preset controls. */
function clearPresetEffects(preset: Preset, effects: ModifierInstance[]): void {
  const allPresetFixtureIds = new Set(preset.categories.flatMap((c) => c.fixtureIds));
  for (let i = effects.length - 1; i >= 0; i--) {
    const eff = effects[i];
    if (eff?.targetFixtureIds?.some((id) => allPresetFixtureIds.has(id))) {
      effects.splice(i, 1);
    }
  }
}

/** Applies channel snapshots and reconstructs modifier effects from a preset. */
function applyPresetToFixtures(preset: Preset, fixtures: Fixture[], effects: ModifierInstance[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  clearPresetEffects(preset, effects);

  // Ids already live: effects the preset does not touch survive the clear and
  // may share a snapshot's id (presets captured from the same session keep
  // the live ids), and a resolved preset can hold one id in two categories.
  const takenIds = new Set(effects.map(e => e.id));

  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      for (const snap of category.channels) {
        const ch = fixture.channels[snap.channelIndex];
        if (!ch || ch.type !== snap.channelType) continue;
        const baseValue = snap.stepValues[0] ?? ch.defaultValue;
        ch.chaserConfig.stepValues = [...snap.stepValues];
        ch.chaserConfig.stepsCount = snap.chaserConfig?.stepsCount ?? snap.stepValues.length;
        ch.chaserConfig.activeEditStep = snap.chaserConfig?.activeEditStep ?? 0;
        ch.chaserConfig.isPlaying = snap.chaserConfig?.isPlaying ?? false;
        if (snap.chaserConfig?.stepDuration) ch.chaserConfig.stepDuration = { ...snap.chaserConfig.stepDuration };
        if (snap.chaserConfig?.fadeDuration) ch.chaserConfig.fadeDuration = { ...snap.chaserConfig.fadeDuration };
        ch.currentBaseValue = baseValue;
      }
    }

    for (const modSnap of category.modifiers) {
      const eff = reconstructEffect(modSnap, takenIds);
      if (eff) {
        eff.targetFixtureIds = [...category.fixtureIds];
        takenIds.add(eff.id);
        effects.push(eff);
      }
    }
  }
}

/**
 * Applies (or reverts, `rgb = null`) a live color override to the preset's
 * fixtures. See `recolorPreset` for the color model. No state is stored here —
 * the override is a fixture-state mutation (tracked for display/Step back in
 * `color-override-ops.ts`); any preset (re-)activation reloads the snapshot.
 */
export function applyRGBOverride(preset: Preset, fixtures: Fixture[], rgb: RGB | null): void {
  recolorPreset(preset, fixtures, rgb);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Applies a preset: clears relevant channels/effects for the preset's
 * fixture-category pairs, then restores values and modifier effects.
 */
export function applyPreset(preset: Preset, fixtures: Fixture[], effects: ModifierInstance[]): void {
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
export function stopPreset(preset: Preset, fixtures: Fixture[], effects: ModifierInstance[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      // Symmetric with applyPreset: reset every channel of this fixture whose
      // type belongs to this category, not just the snapshots the preset stored.
      // Otherwise stale chaserConfig from prior modifiers (noise/sequencer that
      // baked stepValues into the channels) survives the stop.
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
