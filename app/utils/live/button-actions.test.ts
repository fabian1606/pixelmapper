/**
 * Rules of scripted live buttons: smart default triggers, which duration
 * modes are offered, and how hold / duration times are computed.
 */
import { describe, expect, it } from 'vitest';
import type { Preset } from '~/utils/engine/preset-types';
import type { ButtonAction, LiveMapping } from './types';
import {
  appearanceLevel,
  autoLabel,
  defaultTriggerFor,
  durationModesFor,
  durationMs,
  effectiveDuration,
  holdMs,
  newButtonAction,
  triggerBadge,
  withMapping,
} from './button-actions';

const preset = (id: string, type?: Preset['type']): Preset =>
  ({ id, name: id.toUpperCase(), createdAt: '', type, categories: [] });
const PRESETS = [preset('warm'), preset('burst', 'flash')];

const action = (trigger: ButtonAction['trigger'], m: LiveMapping, extra: Partial<ButtonAction> = {}): ButtonAction =>
  ({ id: 'a', trigger, action: m, ...extra });

describe('defaultTriggerFor', () => {
  it('uses While pressing for flash presets and blackout, On press for normal presets', () => {
    expect(defaultTriggerFor({ type: 'preset', presetId: 'warm' }, PRESETS)).toBe('press');
    expect(defaultTriggerFor({ type: 'preset', presetId: 'burst' }, PRESETS)).toBe('hold');
    expect(defaultTriggerFor({ type: 'global-function', globalFunction: 'blackout' }, PRESETS)).toBe('hold');
  });

  it('protects Stop all behind a long press', () => {
    expect(defaultTriggerFor({ type: 'global-function', globalFunction: 'stop-all' }, PRESETS)).toBe('long');
  });
});

describe('withMapping', () => {
  it('follows the smart default until the user picked a trigger', () => {
    const blackout: LiveMapping = { type: 'global-function', globalFunction: 'blackout' };
    expect(withMapping(newButtonAction(), blackout, PRESETS).trigger).toBe('hold');
    const touched = { ...newButtonAction(), trigger: 'toggle' as const, triggerTouched: true };
    expect(withMapping(touched, blackout, PRESETS).trigger).toBe('toggle');
  });
});

describe('durationModesFor', () => {
  it('offers nothing for While pressing, Toggle and instant actions', () => {
    expect(durationModesFor(action('hold', { type: 'preset', presetId: 'warm' }))).toEqual([]);
    expect(durationModesFor(action('toggle', { type: 'global-function', globalFunction: 'strobe' }))).toEqual([]);
    expect(durationModesFor(action('press', { type: 'page-switch', targetPageId: 'p' }))).toEqual([]);
    expect(durationModesFor(action('long', { type: 'global-function', globalFunction: 'stop-all' }))).toEqual([]);
  });

  it('offers Once only for presets', () => {
    expect(durationModesFor(action('release', { type: 'preset', presetId: 'warm' }))).toContain('once');
    expect(durationModesFor(action('press', { type: 'global-function', globalFunction: 'blackout' }))).not.toContain('once');
  });

  it('falls back to forever when the stored mode is not offered', () => {
    const a = action('press', { type: 'global-function', globalFunction: 'blackout' }, { duration: { mode: 'once' } });
    expect(effectiveDuration(a)).toEqual({ mode: 'forever' });
  });
});

describe('times', () => {
  it('converts beats with the BPM and keeps ms as-is', () => {
    expect(durationMs({ mode: 'beats', beats: 2 }, 120, 0)).toBe(1000);
    expect(durationMs({ mode: 'time', ms: 300 }, 120, 0)).toBe(300);
    expect(durationMs({ mode: 'once' }, 120, 1500)).toBe(1500);
    expect(durationMs({ mode: 'forever' }, 120, 0)).toBeNull();
  });

  it('defaults a long press to 1 s and supports beats', () => {
    const blackout: LiveMapping = { type: 'global-function', globalFunction: 'blackout' };
    expect(holdMs(action('long', blackout), 120)).toBe(1000);
    expect(holdMs(action('long', blackout, { hold: { mode: 'beats', beats: 4 } }), 120)).toBe(2000);
  });
});

describe('appearance and labels', () => {
  it('dims inactive buttons by default and turns them off on request', () => {
    expect(appearanceLevel(undefined, true, 0, 120)).toBe(1);
    expect(appearanceLevel(undefined, false, 0, 120)).toBe(0.35);
    expect(appearanceLevel({ inactive: 'off' }, false, 0, 120)).toBe(0);
  });

  it('labels a button after its first named action', () => {
    const actions = [action('press', { type: 'none' }), action('hold', { type: 'preset', presetId: 'warm' })];
    expect(autoLabel(actions, PRESETS)).toBe('WARM');
  });

  it('summarises trigger kinds in the canvas badge', () => {
    const actions = [
      action('hold', { type: 'global-function', globalFunction: 'blackout' }),
      action('long', { type: 'global-function', globalFunction: 'stop-all' }),
    ];
    expect(triggerBadge(actions)).toBe('⚡⏳');
  });
});

describe('default action', () => {
  it('starts every new button with one empty On press action', async () => {
    const { defaultLiveWidget } = await import('./types');
    const w = defaultLiveWidget('button');
    expect(w.actions).toHaveLength(1);
    expect(w.actions?.[0]).toMatchObject({ trigger: 'press', action: { type: 'none' } });
    expect(defaultLiveWidget('slider').actions).toBeUndefined();
  });
});

describe('key and MIDI inputs', () => {
  it('turns note / CC messages into presses and releases', async () => {
    const { parseMidiInput, midiMatches, midiLabel, keyLabel } = await import('./button-actions');
    expect(parseMidiInput([0x90, 36, 100])).toEqual({ message: { type: 'note', channel: 1, number: 36 }, down: true });
    expect(parseMidiInput([0x99, 36, 0])).toEqual({ message: { type: 'note', channel: 10, number: 36 }, down: false });
    expect(parseMidiInput([0x80, 36, 64])?.down).toBe(false);
    expect(parseMidiInput([0xb2, 7, 127])).toEqual({ message: { type: 'cc', channel: 3, number: 7 }, down: true });
    expect(parseMidiInput([0xb2, 7, 0])?.down).toBe(false);
    expect(parseMidiInput([0xe0, 0, 64])).toBeNull();
    expect(midiMatches({ type: 'note', channel: 1, number: 36 }, { type: 'note', channel: 1, number: 36 })).toBe(true);
    expect(midiMatches({ type: 'note', channel: 2, number: 36 }, { type: 'note', channel: 1, number: 36 })).toBe(false);
    expect(midiLabel({ type: 'cc', channel: 10, number: 7 })).toBe('CC 7 · Ch 10');
    expect(keyLabel('KeyB')).toBe('B');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Space')).toBe('Space');
  });
});
