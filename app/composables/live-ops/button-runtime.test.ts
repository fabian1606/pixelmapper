/**
 * Button runtime: triggers (press / double / long / hold / release / toggle)
 * and durations map onto the flash stack, overwrites and applyMapping.
 * Stores and engine primitives are mocked; timers are fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ButtonAction } from '~/utils/live/types';

const calls: string[] = [];
const engineStore = {
  savedPresets: [
    { id: 'warm', name: 'Warm', createdAt: '', categories: [] },
    { id: 'cool', name: 'Cool', createdAt: '', categories: [] },
    { id: 'burst', name: 'Burst', type: 'flash', createdAt: '', categories: [] },
  ],
  selectedPresetId: null as string | null,
  engine: { globalBpm: { value: 120 } },
  speedMultiplier: 1,
  baseBpm: 120,
  setSpeedMultiplier: (m: number) => { calls.push(`speed:${m}`); engineStore.speedMultiplier = m; },
  clearOverwriteStack: () => calls.push('clearOverwrites'),
};

vi.mock('~/stores/engine-store', () => ({ useEngineStore: () => engineStore }));
vi.mock('~/stores/live-bus-store', () => ({ useLiveBusStore: () => ({ dispatch: (t: string) => calls.push(`bus:${t}`) }) }));
vi.mock('~/components/engine/composables/preset-activation', () => ({
  setActivePreset: (id: string | null) => { calls.push(`preset:${id}`); engineStore.selectedPresetId = id; },
  pressFlashPreset: (_k: string, id: string) => calls.push(`flash+:${id}`),
  releaseFlashPreset: () => calls.push('flash-'),
  stopEverything: () => { calls.push('stopEverything'); engineStore.selectedPresetId = null; },
}));
const colorOverrides = new Map<string, { r: number; g: number; b: number }>();
vi.mock('./color-override-ops', () => ({
  getColorOverride: (id: string | null) => (id ? colorOverrides.get(id) ?? null : null),
  setColorOverride: (id: string, rgb: { r: number; g: number; b: number } | null) => {
    calls.push(`color:${id}:${rgb ? rgb.r : 'own'}`);
    if (rgb) colorOverrides.set(id, rgb); else colorOverrides.delete(id);
  },
}));
vi.mock('~/stores/live-mode-store', () => ({ useLiveModeStore: () => ({ activeSectionMembers: new Map() }) }));
vi.mock('~/components/engine/composables/preset-resolve', () => ({ resolvePreset: (p: unknown) => p }));
vi.mock('./apply-mapping', () => ({
  applyMapping: (m: { globalFunction?: string; type: string }, active: boolean) =>
    calls.push(`${m.globalFunction ?? m.type}:${active ? 'on' : 'off'}`),
}));

const { pressButton, releaseButton, isButtonActive, stopAll } = await import('./button-runtime');
const { stepBack, clearLiveHistory } = await import('./live-history');

const blackout = { type: 'global-function' as const, globalFunction: 'blackout' as const };
const act = (id: string, trigger: ButtonAction['trigger'], extra: Partial<ButtonAction> = {}): ButtonAction =>
  ({ id, trigger, action: blackout, ...extra });
const ctx = { key: 'btn' };

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  engineStore.selectedPresetId = null;
  engineStore.speedMultiplier = 1;
  colorOverrides.clear();
});
afterEach(() => {
  stopAll();
  clearLiveHistory();
  vi.useRealTimers();
});

describe('button runtime', () => {
  it('While pressing runs until release', () => {
    const actions = [act('a', 'hold')];
    pressButton(actions, ctx);
    expect(calls).toEqual(['blackout:on']);
    expect(isButtonActive('btn', actions)).toBe(true);
    releaseButton(actions, ctx);
    expect(calls).toEqual(['blackout:on', 'blackout:off']);
    expect(isButtonActive('btn', actions)).toBe(false);
  });

  it('On press with a time duration stops by itself', () => {
    const actions = [act('a', 'press', { duration: { mode: 'time', ms: 2000 } })];
    pressButton(actions, ctx);
    releaseButton(actions, ctx);
    expect(calls).toEqual(['blackout:on']);
    vi.advanceTimersByTime(2000);
    expect(calls).toEqual(['blackout:on', 'blackout:off']);
  });

  it('Toggle switches on, then off on the next press', () => {
    const actions = [act('a', 'toggle')];
    pressButton(actions, ctx); releaseButton(actions, ctx);
    vi.advanceTimersByTime(400);
    pressButton(actions, ctx); releaseButton(actions, ctx);
    expect(calls).toEqual(['blackout:on', 'blackout:off']);
  });

  it('On double press fires only on the second press within 300 ms', () => {
    const actions = [act('a', 'double', { duration: { mode: 'beats', beats: 1 } })];
    const dbl = { key: 'dbl' };
    pressButton(actions, dbl); releaseButton(actions, dbl);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(200);
    pressButton(actions, dbl); releaseButton(actions, dbl);
    expect(calls).toEqual(['blackout:on']);
  });

  it('On long press fires after the hold time and is cancelled by an early release', () => {
    const stop = { type: 'global-function' as const, globalFunction: 'stop-all' as const };
    const actions = [act('short', 'press', { duration: { mode: 'time', ms: 2000 } }), act('long', 'long', { action: stop, hold: { mode: 'time', ms: 3000 } })];
    pressButton(actions, ctx);
    vi.advanceTimersByTime(1000);
    releaseButton(actions, ctx);
    vi.advanceTimersByTime(5000);
    expect(calls).not.toContain('stopEverything');

    calls.length = 0;
    pressButton(actions, ctx);
    vi.advanceTimersByTime(3000);
    expect(calls).toContain('stopEverything');
  });

  it('While pressing + On long press Stop all: releasing afterwards does not bring the look back', () => {
    const stop = { type: 'global-function' as const, globalFunction: 'stop-all' as const };
    const actions = [act('bo', 'hold'), act('st', 'long', { action: stop, hold: { mode: 'time', ms: 3000 } })];
    const k = { key: 'combo' };
    pressButton(actions, k);
    vi.advanceTimersByTime(3000);
    releaseButton(actions, k);
    // Blackout on, then one combined stop — no separate blackout release in between or after.
    expect(calls).toEqual(['blackout:on', 'stopEverything', 'speed:1']);
  });

  it('a normal preset on press becomes the active preset; held it flashes', () => {
    const warm = { type: 'preset' as const, presetId: 'warm' };
    pressButton([act('p', 'press', { action: warm })], ctx);
    expect(calls).toEqual(['preset:warm']);
    expect(isButtonActive('btn', [act('p', 'press', { action: warm })])).toBe(true);

    calls.length = 0;
    const held = [act('h', 'hold', { action: warm })];
    pressButton(held, { key: 'other' });
    releaseButton(held, { key: 'other' });
    expect(calls).toEqual(['flash+:warm', 'flash-']);
  });

  it('Once plays a preset for one pass (1 beat when nothing animates)', () => {
    const actions = [act('o', 'release', { action: { type: 'preset', presetId: 'warm' }, duration: { mode: 'once' } })];
    pressButton(actions, ctx);
    releaseButton(actions, ctx);
    expect(calls).toEqual(['flash+:warm']);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['flash+:warm', 'flash-']);
  });
});

describe('step back', () => {
  const warm = { type: 'preset' as const, presetId: 'warm' };
  const cool = { type: 'preset' as const, presetId: 'cool' };
  const tap = (actions: ButtonAction[], key: string) => {
    pressButton(actions, { key }); releaseButton(actions, { key });
    vi.advanceTimersByTime(400);
  };

  it('returns to the preset that was active before', () => {
    tap([act('w', 'press', { action: warm })], 'w');
    tap([act('c', 'press', { action: cool })], 'c');
    calls.length = 0;
    expect(stepBack()).toBe(true);
    expect(calls).toEqual(['preset:warm']);
  });

  it('undoes a toggled blackout', () => {
    tap([act('t', 'toggle')], 't');
    calls.length = 0;
    stepBack();
    expect(calls).toEqual(['blackout:off']);
  });

  it('brings everything back after Stop all', () => {
    const toggled = [act('t', 'toggle')];
    tap([act('w', 'press', { action: warm })], 'w');
    tap(toggled, 't');
    stopAll();
    calls.length = 0;
    stepBack();
    expect(calls).toEqual(['blackout:on', 'preset:warm']);
    expect(isButtonActive('t', toggled)).toBe(true);
  });

  it('ignores momentary actions', () => {
    tap([act('h', 'hold')], 'h');
    expect(stepBack()).toBe(false);
  });

  it('a Step back button steps back', () => {
    tap([act('w', 'press', { action: warm })], 'w');
    tap([act('c', 'press', { action: cool })], 'c');
    calls.length = 0;
    tap([act('b', 'press', { action: { type: 'global-function', globalFunction: 'step-back' } })], 'b');
    expect(calls).toEqual(['preset:warm']);
  });

  it('undoes a color variant on the active preset', async () => {
    const { recordLiveStep } = await import('./live-history');
    const { setColorOverride } = await import('./color-override-ops');
    tap([act('w', 'press', { action: warm })], 'w');
    recordLiveStep();
    setColorOverride('warm', { r: 255, g: 0, b: 0 });
    recordLiveStep();
    setColorOverride('warm', { r: 0, g: 0, b: 255 });
    calls.length = 0;
    stepBack();
    expect(calls).toEqual(['color:warm:255']);
    stepBack();
    expect(calls).toEqual(['color:warm:255', 'color:warm:own']);
  });
});
