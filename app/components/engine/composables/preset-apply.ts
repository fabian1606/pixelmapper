import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import { cloneModifier } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { RGB } from '~/utils/live/color-utils';
import { rgbToHsv, hsvToRgb } from '~/utils/live/color-utils';
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
 * Recreates a live modifier from a preset/pinned snapshot (deep copy; a new
 * id when the snapshot has none). Returns null for unknown plugins.
 */
export function reconstructEffect(snap: ModifierInstance): ModifierInstance | null {
  if (!snap?.plugin || !getManifest(snap.plugin)) return null;
  const m = cloneModifier(snap);
  if (!m.id) m.id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
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

/** Index of the first category in this preset that has any RGB channels, or -1. */
function primaryRGBCategoryIndex(preset: Preset): number {
  for (let i = 0; i < preset.categories.length; i++) {
    const cat = preset.categories[i];
    if (!cat) continue;
    for (const snap of cat.channels) {
      if (snap.channelType === 'RED' || snap.channelType === 'GREEN' || snap.channelType === 'BLUE') {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Read the FIRST pixel's natural RGB triple at step 0. A multi-pixel fixture
 * has multiple RED/GREEN/BLUE channels in the same category snapshot; we take
 * the first occurrence of each type so this is "pixel 0's color".
 */
function categoryNaturalRGBAtStep0(category: Preset['categories'][number]): RGB | null {
  let r: number | null = null, g: number | null = null, b: number | null = null;
  for (const snap of category.channels) {
    if (snap.channelType === 'RED'   && r === null) r = snap.stepValues[0] ?? 0;
    if (snap.channelType === 'GREEN' && g === null) g = snap.stepValues[0] ?? 0;
    if (snap.channelType === 'BLUE'  && b === null) b = snap.stepValues[0] ?? 0;
    if (r !== null && g !== null && b !== null) break;
  }
  if (r === null && g === null && b === null) return null;
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
}

/** Below this HSV saturation a sample counts as achromatic (white/gray/black). */
const ACHROMATIC_EPS = 0.001;

/**
 * How a color override transforms every natural sample of a preset. Derived
 * once from (primary natural pixel-0/step-0 color → override color).
 */
export interface ColorShift {
  /** Hue delta in degrees added to every chromatic sample. */
  hueDelta: number;
  /** Factor applied to every chromatic sample's saturation (clamped to 1). */
  satScale: number;
  /**
   * Set when the primary natural color is achromatic: achromatic samples are
   * tinted to this hue/saturation (keeping their value), since a hue delta
   * relative to a gray reference is meaningless.
   */
  tint: { h: number; s: number } | null;
}

/**
 * Builds the shift that maps `primaryNatural` onto `override` in hue AND
 * saturation. Pure hue rotation can't reach white/gray overrides (saturation
 * stays as-is), so the saturation ratio override.s / primary.s is applied to
 * every chromatic sample: picking white desaturates the whole composition
 * while every step keeps its brightness.
 */
export function buildColorShift(primaryNatural: RGB, override: RGB): ColorShift {
  const prim = rgbToHsv(primaryNatural.r, primaryNatural.g, primaryNatural.b);
  const ov = rgbToHsv(override.r, override.g, override.b);
  if (prim.s < ACHROMATIC_EPS) {
    return { hueDelta: ov.h - prim.h, satScale: 1, tint: { h: ov.h, s: ov.s } };
  }
  return { hueDelta: ov.h - prim.h, satScale: ov.s / prim.s, tint: null };
}

/** Applies a `ColorShift` to one natural RGB sample, keeping its HSV value. */
export function shiftSample(rgb: RGB, shift: ColorShift): RGB {
  const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (s < ACHROMATIC_EPS) {
    // Achromatic samples only change when the reference itself was achromatic.
    return shift.tint ? hsvToRgb(shift.tint.h, shift.tint.s, v) : { ...rgb };
  }
  const hue = ((h + shift.hueDelta) % 360 + 360) % 360;
  return hsvToRgb(hue, Math.min(1, s * shift.satScale), v);
}

/**
 * For one category, build shifted stepValues arrays for ALL its R/G/B channels.
 *
 * Multi-pixel fixtures have multiple (RED, GREEN, BLUE) channel snapshots in
 * the same category snapshot — one triple per pixel, in channel-order. Each
 * pixel is rotated independently using its own natural hue.
 *
 * Every step of every pixel of every category gets the same `ColorShift`
 * (hue delta + saturation scale, see `buildColorShift`), keeping each step's
 * natural value, so multi-step / multi-color / multi-pixel presets keep their
 * composition — and white/gray overrides desaturate it instead of being ignored.
 *
 * Special case (isPrimary && pixel === 0 && step === 0): use the override RGB
 * verbatim, so the wheel's exact picked color appears at the focal point.
 *
 * Returns Map<channelIndex, number[]> or null if the category has no RGB channels.
 */
function rotateCategorySteps(
  category: Preset['categories'][number],
  override: RGB,
  shift: ColorShift,
  isPrimary: boolean,
): Map<number, number[]> | null {
  type Snap = typeof category.channels[number];
  const redSnaps: Snap[] = [];
  const greenSnaps: Snap[] = [];
  const blueSnaps: Snap[] = [];
  for (const snap of category.channels) {
    if (snap.channelType === 'RED')   redSnaps.push(snap);
    else if (snap.channelType === 'GREEN') greenSnaps.push(snap);
    else if (snap.channelType === 'BLUE')  blueSnaps.push(snap);
  }
  if (redSnaps.length === 0 && greenSnaps.length === 0 && blueSnaps.length === 0) return null;

  const pixelCount = Math.max(redSnaps.length, greenSnaps.length, blueSnaps.length);

  const result = new Map<number, number[]>();

  for (let p = 0; p < pixelCount; p++) {
    const redSnap = redSnaps[p];
    const greenSnap = greenSnaps[p];
    const blueSnap = blueSnaps[p];

    const stepCount = Math.max(
      redSnap?.stepValues.length ?? 0,
      greenSnap?.stepValues.length ?? 0,
      blueSnap?.stepValues.length ?? 0,
    );
    if (stepCount === 0) continue;

    const redOut: number[] = [];
    const greenOut: number[] = [];
    const blueOut: number[] = [];

    for (let i = 0; i < stepCount; i++) {
      const r = redSnap?.stepValues[i] ?? 0;
      const g = greenSnap?.stepValues[i] ?? 0;
      const b = blueSnap?.stepValues[i] ?? 0;

      const rotated: RGB = (isPrimary && p === 0 && i === 0)
        ? override
        : shiftSample({ r, g, b }, shift);
      redOut.push(rotated.r);
      greenOut.push(rotated.g);
      blueOut.push(rotated.b);
    }

    if (redSnap)   result.set(redSnap.channelIndex, redOut);
    if (greenSnap) result.set(greenSnap.channelIndex, greenOut);
    if (blueSnap)  result.set(blueSnap.channelIndex, blueOut);
  }

  return result;
}

/** Applies channel snapshots and reconstructs modifier effects from a preset. */
function applyPresetToFixtures(preset: Preset, fixtures: Fixture[], effects: ModifierInstance[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  clearPresetEffects(preset, effects);

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
      const eff = reconstructEffect(modSnap);
      if (eff) {
        eff.targetFixtureIds = [...category.fixtureIds];
        effects.push(eff);
      }
    }
  }
}

/**
 * Mutates fixture R/G/B channel step values to apply (or revert) a color
 * override. The wheel's exact color is applied to the preset's primary RGB
 * category at step 0; every other step (in primary and in any other RGB
 * category) gets the same hue + saturation shift so multi-step / multi-color
 * presets keep their composition (white overrides desaturate it). Passing `rgb=null` writes the natural
 * snapshot stepValues back — the fast-path "revert".
 *
 * No state is stored — the override is purely a fixture-state mutation. Any
 * subsequent preset (re-)activation reloads the snapshot via
 * `applyPresetToFixtures` and naturally clears the override.
 */
export function applyRGBOverride(preset: Preset, fixtures: Fixture[], rgb: RGB | null): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));
  const primaryIdx = rgb ? primaryRGBCategoryIndex(preset) : -1;
  const primaryNatural = (rgb && primaryIdx >= 0)
    ? categoryNaturalRGBAtStep0(preset.categories[primaryIdx]!)
    : null;
  const shift = (rgb && primaryNatural) ? buildColorShift(primaryNatural, rgb) : null;

  for (let catIdx = 0; catIdx < preset.categories.length; catIdx++) {
    const category = preset.categories[catIdx];
    if (!category) continue;
    const isPrimary = catIdx === primaryIdx;
    const rotated = (rgb && shift)
      ? rotateCategorySteps(category, rgb, shift, isPrimary)
      : null;

    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;
      for (const snap of category.channels) {
        if (snap.channelType !== 'RED' && snap.channelType !== 'GREEN' && snap.channelType !== 'BLUE') continue;
        const ch = fixture.channels[snap.channelIndex];
        if (!ch || ch.type !== snap.channelType) continue;
        const stepValuesOut = rotated?.get(snap.channelIndex) ?? [...snap.stepValues];
        ch.chaserConfig.stepValues = stepValuesOut;
        ch.chaserConfig.stepsCount = stepValuesOut.length;
        ch.currentBaseValue = stepValuesOut[0] ?? ch.defaultValue;
      }
    }
  }
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
