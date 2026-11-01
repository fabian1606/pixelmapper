import type { Preset, PresetChannelSnapshot } from '~/utils/engine/preset-types';
import type { ChannelChaserConfig } from '~/utils/engine/types';
import type { RGB } from '~/utils/live/color-utils';
import { rgbToHsv } from '~/utils/live/color-utils';
import { ACHROMATIC_EPS, buildColorShift, shiftSample } from '~/utils/live/color-shift';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The fixture shape recoloring needs (a structural subset of `Fixture`). */
export interface RecolorFixture {
  id: string | number;
  channels: { type: string; beamId?: string; defaultValue: number; chaserConfig: ChannelChaserConfig }[];
}

type Rgb3 = 'red' | 'green' | 'blue';
const RGB_KEYS: Rgb3[] = ['red', 'green', 'blue'];
const KEY_OF: Record<string, Rgb3> = { RED: 'red', GREEN: 'green', BLUE: 'blue' };

/** One color channel of a head: where it sits and its preset snapshot (if captured). */
interface HeadChannel {
  channelIndex: number;
  /** Absent when the preset did not capture it: it sat at its default value. */
  snap?: PresetChannelSnapshot;
  defaultValue: number;
}

/** One RGB head (pixel) of a fixture in a preset category. */
type Head = Partial<Record<Rgb3, HeadChannel>>;

// ── Heads ─────────────────────────────────────────────────────────────────────

/** True when the category captured at least one RED/GREEN/BLUE channel. */
function hasRgbSnapshot(category: Preset['categories'][number]): boolean {
  return category.channels.some(s => s.channelType in KEY_OF);
}

/**
 * The RGB heads of one fixture under a category. Heads come from the
 * fixture's own layout (channels grouped by `beamId`), not from the
 * snapshot: presets only capture non-default channels, so a magenta preset
 * has no GREEN snapshot — pairing the p-th captured RED/GREEN/BLUE would
 * shift pixels, and a recolor could never turn GREEN on. Without a fixture
 * the snapshot order is the best guess.
 */
function categoryHeads(category: Preset['categories'][number], fixture: RecolorFixture | undefined): Head[] {
  const snapByIndex = new Map(category.channels.map(s => [s.channelIndex, s]));
  if (!fixture) {
    const heads: Head[] = [];
    const seen: Record<Rgb3, number> = { red: 0, green: 0, blue: 0 };
    for (const snap of category.channels) {
      const key = KEY_OF[snap.channelType];
      if (!key) continue;
      const head = (heads[seen[key]++] ??= {});
      head[key] = { channelIndex: snap.channelIndex, snap, defaultValue: 0 };
    }
    return heads;
  }
  const byBeam = new Map<string, Head>();
  fixture.channels.forEach((ch, channelIndex) => {
    const key = KEY_OF[ch.type];
    if (!key) return;
    const beam = ch.beamId ?? '';
    const head = byBeam.get(beam) ?? {};
    // First channel of a type per beam wins (matches the engine's head layout).
    head[key] ??= { channelIndex, snap: snapByIndex.get(channelIndex), defaultValue: ch.defaultValue };
    byBeam.set(beam, head);
  });
  return [...byBeam.values()];
}

/** The steps a head channel plays (stepsCount-limited, as the engine sees them). */
function channelSteps(ch: HeadChannel | undefined): number[] {
  if (!ch) return [0];
  if (!ch.snap) return [ch.defaultValue];
  const count = ch.snap.chaserConfig?.stepsCount ?? ch.snap.stepValues.length;
  const steps = ch.snap.stepValues.slice(0, Math.max(1, count));
  return steps.length > 0 ? steps : [ch.defaultValue];
}

/** All natural samples of a head, one per step (shorter channels repeat). */
function headSamples(head: Head): RGB[] {
  const steps = RGB_KEYS.map(k => channelSteps(head[k]));
  const n = Math.max(...steps.map(s => s.length));
  return Array.from({ length: n }, (_, i) => {
    const [r, g, b] = steps.map(s => s[i % s.length] ?? 0);
    return { r: r!, g: g!, b: b! };
  });
}

/** Iterates every RGB head of every fixture the preset colors. */
function forEachHead(
  preset: Preset,
  fixtures: readonly RecolorFixture[],
  visit: (head: Head, fixture: RecolorFixture | undefined) => void,
  firstFixtureOnly = false,
): void {
  const byId = new Map(fixtures.map(f => [f.id, f]));
  for (const category of preset.categories) {
    if (!hasRgbSnapshot(category)) continue;
    const present = category.fixtureIds.map(id => byId.get(id)).filter(f => f !== undefined);
    const targets = present.length === 0 ? [undefined] : firstFixtureOnly ? present.slice(0, 1) : present;
    for (const fixture of targets) {
      for (const head of categoryHeads(category, fixture)) visit(head, fixture);
    }
  }
}

// ── Reference color ───────────────────────────────────────────────────────────

/** Width of the hue buckets used to find the dominant hue. */
const HUE_BUCKET_DEG = 30;

/**
 * The preset's natural reference color: the most vivid sample of its
 * dominant hue (hue buckets weighted by saturation × value) across all RGB
 * heads and steps; the brightest sample if the preset is achromatic. Pixel 0
 * / step 0 is not representative (a sparkle starts dark).
 */
export function findPresetReferenceColor(preset: Preset, fixtures: readonly RecolorFixture[] = []): RGB | null {
  const weights = new Map<number, number>();
  const chromatic: { rgb: RGB; bucket: number; vivid: number }[] = [];
  let brightest: { rgb: RGB; v: number } | null = null;

  forEachHead(preset, fixtures, (head) => {
    for (const rgb of headSamples(head)) {
      const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (!brightest || v > brightest.v) brightest = { rgb, v };
      if (s < ACHROMATIC_EPS) continue;
      const bucket = Math.round(h / HUE_BUCKET_DEG) % (360 / HUE_BUCKET_DEG);
      weights.set(bucket, (weights.get(bucket) ?? 0) + s * v);
      chromatic.push({ rgb, bucket, vivid: s * v });
    }
  }, true);

  let bestBucket = -1;
  let bestWeight = -1;
  for (const [bucket, weight] of weights) {
    if (weight > bestWeight) { bestWeight = weight; bestBucket = bucket; }
  }
  let pick: RGB | null = (brightest as { rgb: RGB } | null)?.rgb ?? null;
  let pickVivid = -1;
  for (const c of chromatic) {
    // Strict ">" keeps the first sample among equals.
    if (c.bucket === bestBucket && c.vivid > pickVivid) { pick = c.rgb; pickVivid = c.vivid; }
  }
  return pick ? { ...pick } : null;
}

// ── Recolor ───────────────────────────────────────────────────────────────────

/** Writes a step list into a live channel, taking the chaser timing from `timing`. */
function writeChannel(fixture: RecolorFixture, index: number, steps: number[], timing: PresetChannelSnapshot['chaserConfig']): void {
  const cc = fixture.channels[index]?.chaserConfig;
  if (!cc) return;
  cc.stepValues = steps;
  cc.stepsCount = steps.length;
  cc.activeEditStep = timing?.activeEditStep ?? 0;
  cc.isPlaying = steps.length > 1 && (timing?.isPlaying ?? false);
  if (timing?.stepDuration) cc.stepDuration = { ...timing.stepDuration };
  if (timing?.fadeDuration) cc.fadeDuration = { ...timing.fadeDuration };
}

/**
 * Recolors (or restores, `rgb = null`) the RED/GREEN/BLUE channels of every
 * fixture the preset colors. Every sample gets the same hue + saturation
 * shift (`buildColorShift`, reference = `findPresetReferenceColor`), keeping
 * its brightness, so multi-step / multi-pixel / multi-color presets keep
 * their composition. All three channels of a head are written — also those
 * the preset never captured — and share the timing of the head's longest
 * chaser, so steps stay aligned.
 */
export function recolorPreset(preset: Preset, fixtures: readonly RecolorFixture[], rgb: RGB | null): void {
  const reference = rgb ? findPresetReferenceColor(preset, fixtures) : null;
  const shift = rgb && reference ? buildColorShift(reference, rgb) : null;

  forEachHead(preset, fixtures, (head, fixture) => {
    if (!fixture) return;
    if (!shift) {
      // Restore: captured channels back to their snapshot, the rest to default.
      for (const key of RGB_KEYS) {
        const ch = head[key];
        if (ch) writeChannel(fixture, ch.channelIndex, channelSteps(ch), ch.snap?.chaserConfig);
      }
      return;
    }
    const samples = headSamples(head).map(s => shiftSample(s, shift));
    const leader = RGB_KEYS.map(k => head[k]).reduce<HeadChannel | undefined>(
      (best, ch) => (ch?.snap && channelSteps(ch).length > (best ? channelSteps(best).length : 0) ? ch : best), undefined);
    for (const key of RGB_KEYS) {
      const ch = head[key];
      if (ch) writeChannel(fixture, ch.channelIndex, samples.map(s => s[key === 'red' ? 'r' : key === 'green' ? 'g' : 'b']), leader?.snap?.chaserConfig);
    }
  });
}
