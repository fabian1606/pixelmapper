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
    { id: 'burst', name: 'Burst', type: 'flash', createdAt: '', categories: [] },
  ],
  selectedPresetId: null as string | null,
  engine: { globalBpm: { value: 120 } },
  setSpeedMultiplier: (m: number) => calls.push(`speed:${m}`),
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
vi.mock('~/stores/live-mode-store', () => ({ useLiveModeStore: () => ({ activeSectionMembers: new Map() }) }));
vi.mock('~/components/engine/composables/preset-resolve', () => ({ resolvePreset: (p: unknown) => p }));
vi.mock('./apply-mapping', () => ({
  applyMapping: (m: { globalFunction?: string; type: string }, active: boolean) =>
    calls.push(`${m.globalFunction ?? m.type}:${active ? 'on' : 'off'}`),
}));

const { pressButton, releaseButton, isButtonActive, stopAll } = await import('./button-runtime');

const blackout = { type: 'global-function' as const, globalFunction: 'blackout' as const };
const act = (id: string, trigger: ButtonAction['trigger'], extra: Partial<ButtonAction> = {}): ButtonAction =>
  ({ id, trigger, action: blackout, ...extra });
const ctx = { key: 'btn' };

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  engineStore.selectedPresetId = null;
});
afterEach(() => {
  stopAll();
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
