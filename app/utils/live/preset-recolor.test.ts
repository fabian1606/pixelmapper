import { describe, expect, it } from 'vitest';
import type { Preset, PresetChannelSnapshot } from '~/utils/engine/preset-types';
import { findPresetReferenceColor, recolorPreset, type RecolorFixture } from './preset-recolor';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPEED = { mode: 'beat', beatValue: 1 } as never;

/** A bar fixture: `pixels` RGB heads (beamId p0, p1, …), channels R,G,B per head. */
function bar(pixels: number): RecolorFixture {
  const channels: RecolorFixture['channels'] = [];
  for (let p = 0; p < pixels; p++) {
    for (const type of ['RED', 'GREEN', 'BLUE']) {
      channels.push({
        type, beamId: `p${p}`, defaultValue: 0,
        chaserConfig: { stepValues: [0], stepsCount: 1, activeEditStep: 0, isPlaying: false, stepDuration: SPEED, fadeDuration: SPEED },
      });
    }
  }
  return { id: 'bar', channels };
}

/** Snapshot of one channel; `playing` marks a running chaser. */
function snap(channelIndex: number, channelType: string, stepValues: number[], playing = false): PresetChannelSnapshot {
  return {
    channelIndex, channelType: channelType as never, stepValues,
    chaserConfig: { stepValues, stepsCount: stepValues.length, activeEditStep: 0, isPlaying: playing, stepDuration: SPEED, fadeDuration: SPEED },
  };
}

/** A one-category color preset over the bar. */
function preset(channels: PresetChannelSnapshot[]): Preset {
  return {
    id: 'p', name: 'p', createdAt: '',
    categories: [{ type: 'color', label: 'bar', fixtureIds: ['bar'], channels, modifiers: [] }],
  };
}

/** Live RGB of one head at one step. */
function headAt(f: RecolorFixture, pixel: number, step = 0): number[] {
  return [0, 1, 2].map(o => f.channels[pixel * 3 + o]!.chaserConfig.stepValues[step]!);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recolorPreset', () => {
  // Magenta on both pixels: GREEN sits at its default, so the preset never captured it.
  const magenta = () => preset([snap(0, 'RED', [255]), snap(2, 'BLUE', [255]), snap(3, 'RED', [128]), snap(5, 'BLUE', [128])]);

  it('turns uncaptured channels on: green works on a magenta preset', () => {
    const f = bar(2);
    recolorPreset(magenta(), [f], { r: 0, g: 255, b: 0 });
    expect(headAt(f, 0)).toEqual([0, 255, 0]);
    expect(headAt(f, 1)).toEqual([0, 128, 0]);
  });

  it('turns a magenta preset white, not pink', () => {
    const f = bar(2);
    recolorPreset(magenta(), [f], { r: 255, g: 255, b: 255 });
    expect(headAt(f, 0)).toEqual([255, 255, 255]);
    expect(headAt(f, 1)).toEqual([128, 128, 128]);
  });

  it('treats every pixel alike: no pixel gets the picked brightness verbatim', () => {
    const f = bar(2);
    const p = preset([snap(0, 'RED', [128]), snap(2, 'BLUE', [128]), snap(3, 'RED', [128]), snap(5, 'BLUE', [128])]);
    recolorPreset(p, [f], { r: 255, g: 0, b: 255 });
    expect(headAt(f, 0)).toEqual(headAt(f, 1));
  });

  it('restores captured channels and resets uncaptured ones to default', () => {
    const f = bar(2);
    recolorPreset(magenta(), [f], { r: 0, g: 255, b: 0 });
    recolorPreset(magenta(), [f], null);
    expect(headAt(f, 0)).toEqual([255, 0, 255]);
    expect(headAt(f, 1)).toEqual([128, 0, 128]);
  });

  it('aligns a static channel with a running chaser in the same head', () => {
    const f = bar(1);
    // Sparkle-like: RED runs dim → peak, BLUE is static at a low level.
    recolorPreset(preset([snap(0, 'RED', [40, 255], true), snap(2, 'BLUE', [20])]), [f], { r: 0, g: 255, b: 0 });
    const green = f.channels[1]!.chaserConfig;
    expect(green.stepValues[1]).toBe(255);
    expect(green.stepValues[0]).toBeLessThan(60);
    expect(green.isPlaying).toBe(true);
    expect(f.channels[2]!.chaserConfig.stepsCount).toBe(2);
  });
});

describe('findPresetReferenceColor', () => {
  it('skips a dark first step and picks the colored peak', () => {
    const p = preset([snap(0, 'RED', [0, 40, 255]), snap(1, 'GREEN', [0, 10, 0]), snap(2, 'BLUE', [0, 30, 180])]);
    expect(findPresetReferenceColor(p, [bar(1)])).toEqual({ r: 255, g: 0, b: 180 });
  });

  it('prefers the dominant hue over a single vivid accent', () => {
    const p = preset([snap(1, 'GREEN', [255]), snap(3, 'RED', [255]), snap(4, 'GREEN', [128]), snap(6, 'RED', [240]), snap(7, 'GREEN', [120])]);
    expect(findPresetReferenceColor(p, [bar(3)])).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('falls back to the brightest sample when everything is achromatic', () => {
    const p = preset([snap(0, 'RED', [0, 255]), snap(1, 'GREEN', [0, 255]), snap(2, 'BLUE', [0, 255])]);
    expect(findPresetReferenceColor(p, [bar(1)])).toEqual({ r: 255, g: 255, b: 255 });
  });
});
