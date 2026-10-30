/**
 * Timed triggers inside a live `observe` (WP-M item 5): actions fire at
 * their offsets while the window runs, through the `modifiers.trigger`
 * path (no undo step), and bad requests fail before capturing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame, LiveTarget, TriggerValue } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import type { ModifierInstance } from '~/utils/engine/types';
import type { FrameCallback, LiveListener } from '~/utils/extensions/live-hub';
import { resetOperationState, seedScene, stubOperationGlobals } from '~/utils/operations/test-utils';
import { observe } from './index';

// ── Setup ───────────────────────────────────────

/** Manifest of the `sha256:flash` test plugin: a trigger `hit` and a number `level`. */
const FLASH = vi.hoisted(() => ({
  hash: 'sha256:flash',
  manifest: {
    name: 'Flash',
    signatures: ['scalar'],
    params: [
      { type: 'trigger', key: 'hit', label: 'Hit', default: { pressed: false } },
      { type: 'number', key: 'level', label: 'Level', default: 1, min: 0, max: 1 },
    ],
  },
}));

// Known manifest for the flash plugin; everything else falls through to the real store.
vi.mock('~/utils/plugins/plugin-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/utils/plugins/plugin-store')>();
  return { ...orig, getManifest: (hash: string) => (hash === FLASH.hash ? FLASH.manifest : orig.getManifest(hash)) };
});

/** A flash modifier with an idle trigger on the DIMMER. */
function flashModifier(id: string): ModifierInstance {
  return {
    id,
    plugin: FLASH.hash,
    signature: 'scalar',
    targetChannels: ['DIMMER'],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    distribution: {} as ModifierInstance['distribution'],
    params: { hit: { pressed: false }, level: 1 },
  };
}

/** Stored trigger value of `fl-1`. */
function hit(): TriggerValue {
  return useEngineStore().modifiers.find(m => m.id === 'fl-1')!.params.hit as TriggerValue;
}

/**
 * Fake engine: 60 fps frames whose scalar output is 1 while `fl-1.hit` is
 * pressed, else 0. Records the window time of every edge it sees.
 */
function fakeEngine() {
  const listeners = new Map<string, LiveListener>();
  let frameCb: FrameCallback | null = null;
  let clock = 0;
  const edges: Array<{ t: number; pressed: boolean }> = [];
  let last = false;
  const hub = {
    subscribe: (t: LiveTarget, l: LiveListener) => {
      if (t.kind === 'signature') listeners.set(`${t.fixtureId}:${t.signature}`, l);
      return () => {};
    },
    addFrameCallback: (cb: FrameCallback) => { frameCb = cb; return () => { frameCb = null; }; },
  };
  // Each wait segment continues the window clock.
  const wait = async (ms: number) => {
    const end = clock + ms;
    for (; clock < end; clock += 1000 / 60) {
      const pressed = hit().pressed;
      if (pressed !== last) edges.push({ t: clock / 1000, pressed });
      last = pressed;
      for (const l of listeners.values()) l(new Float32Array([pressed ? 1 : 0]));
      frameCb?.({ timeMs: 1000 + clock, beat: { beatTime: 0, bpm: 120, phase: 0 }, dmx: new Uint8Array(512) } as LiveFrame);
    }
  };
  return { deps: { hub, wait, now: () => clock }, edges };
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a' }]);
  const store = useEngineStore();
  store.modifiers.splice(0, store.modifiers.length, flashModifier('fl-1'));
});
afterEach(() => vi.restoreAllMocks());

// ── Tests ───────────────────────────────────────

describe('observe triggers (live)', () => {
  it('fires press and release at their offsets inside the window, without undo steps', async () => {
    const { deps, edges } = fakeEngine();
    const report = await observe({
      targets: 'all',
      window: { duration: '2s' },
      triggers: [
        { at: '1.5s', modifierId: 'fl-1', paramKey: 'hit', action: 'release' },
        { at: '0.5s', modifierId: 'fl-1', paramKey: 'hit', action: 'press' },
      ],
    }, deps);
    expect(report.json.window).toMatchObject({ mode: 'live' });
    // The engine saw the press at 0.5 s and the release at 1.5 s (± one frame).
    expect(edges.map(e => e.pressed)).toEqual([true, false]);
    expect(edges[0]!.t).toBeCloseTo(0.5, 1);
    expect(edges[1]!.t).toBeCloseTo(1.5, 1);
    // The capture shows the hold: the output is on for about half the window.
    const range = (report.json.group as { range: { mean: number } }).range;
    expect(range.mean).toBeGreaterThan(0.4);
    expect(range.mean).toBeLessThan(0.6);
    expect(report.findings?.filter(f => f.code === 'observe-trigger')).toHaveLength(2);
    expect(hit().pressed).toBe(false);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('a click ×2 fires a double-click burst and a held trigger is reported', async () => {
    const { deps } = fakeEngine();
    const report = await observe({
      targets: 'all',
      triggers: [
        { at: 0.2, modifierId: 'fl-1', paramKey: 'hit', action: 'click', clicks: 2 },
        { at: 1, modifierId: 'fl-1', paramKey: 'hit', action: 'press' },
      ],
    }, deps);
    expect(report.findings?.find(f => f.code === 'observe-trigger')?.message).toMatch(/click ×2 fl-1\.hit at 0\.20s/);
    expect(report.findings?.some(f => f.code === 'observe-trigger-held' && f.level === 'warning')).toBe(true);
    expect(hit().pressed).toBe(true);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it.each([
    ['preview mode', { mode: 'preview' as const, modifierId: 'fl-1' }, /need mode "live"/],
    ['at outside the window', { window: { duration: '1s' }, at: '2s' }, /inside the window/],
    ['unknown modifier', { modifierId: 'nope' }, /nope/],
    ['not a trigger param', { paramKey: 'level' }, /not a trigger/],
  ])('fails before capturing: %s', async (_, patch, message) => {
    const { deps, edges } = fakeEngine();
    const { mode, modifierId, window, at, paramKey } = patch as Record<string, never>;
    const report = await observe({
      targets: 'all',
      ...(mode ? { mode } : {}),
      ...(window ? { window } : {}),
      ...(mode && modifierId ? { modifierId } : {}),
      triggers: [{ at: at ?? '0.5s', modifierId: (!mode && modifierId) || 'fl-1', paramKey: paramKey ?? 'hit', action: 'press' }],
    }, deps);
    expect(report.text).toMatch(/^observe · failed/);
    expect(report.findings?.[0]?.code).toBe('invalid-input');
    expect(report.findings?.[0]?.message).toMatch(message);
    expect(edges).toEqual([]);
    expect(hit().pressed).toBe(false);
  });

  it('rejects unknown keys in a trigger (strict schema)', async () => {
    const { deps } = fakeEngine();
    const report = await observe({
      targets: 'all',
      triggers: [{ at: '0.5s', modifierId: 'fl-1', paramKey: 'hit', action: 'press', value: { pressed: true } } as never],
    }, deps);
    expect(report.findings?.[0]?.code).toBe('invalid-input');
    expect(report.findings?.[0]?.message).toMatch(/value/);
  });
});
