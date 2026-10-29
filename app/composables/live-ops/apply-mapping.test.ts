/**
 * Runtime dispatch of `effect-param` mappings (`applyMapping`): xy pads drive
 * point params, buttons drive bool params (toggle / momentary), sliders drive
 * number params. Every plugin-param write is synced via `modifier.update`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import type { ModifierInstance } from '~/utils/engine/types';
import type { LiveMapping } from '~/utils/live/types';
import { resetOperationState, stubOperationGlobals } from '~/utils/operations/test-utils';
import { applyMapping, isFlashMapping } from './apply-mapping';

// ── Setup ───────────────────────────────────────

/** Test plugin manifest with a number, a bool and a point param. */
const PLUGIN = vi.hoisted(() => ({
  hash: 'sha256:apply-mapping-test',
  manifest: {
    params: [
      { type: 'number', key: 'gain', label: 'Gain', min: 0, max: 2, default: 1 },
      { type: 'bool', key: 'invert', label: 'Invert', default: false },
      { type: 'point', key: 'origin', label: 'Origin', default: { x: 0.5, y: 0.5 } },
    ],
  },
}));

// Known manifest for the test plugin; everything else falls through to the real store.
vi.mock('~/utils/plugins/plugin-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/utils/plugins/plugin-store')>();
  return { ...orig, getManifest: (hash: string) => (hash === PLUGIN.hash ? PLUGIN.manifest : orig.getManifest(hash)) };
});

/** Spy on the live bus dispatch of the current Pinia. */
let dispatch: ReturnType<typeof vi.fn<(type: string, payload: unknown) => void>>;

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  useEngineStore().modifiers = [{
    id: 'mod-1',
    plugin: PLUGIN.hash,
    signature: 'rgb',
    targetChannels: [],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    distribution: {} as ModifierInstance['distribution'],
    params: { gain: 1, invert: false, origin: { x: 0.5, y: 0.5 } },
  }];
  dispatch = vi.fn<(type: string, payload: unknown) => void>();
  vi.spyOn(useLiveBusStore(), 'dispatch').mockImplementation(dispatch);
});

/** Current params of the test modifier. */
const params = () => useEngineStore().modifiers[0]!.params as Record<string, unknown>;

/** `effect-param` mapping on plugin param `key`. */
const mapping = (key: string, extra: Partial<LiveMapping> = {}): LiveMapping => ({ type: 'effect-param', effectId: 'mod-1', paramKey: `params.${key}`, ...extra });

/** Lets queued `modifier.update` dispatches run. */
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

// ── Tests ───────────────────────────────────────

describe('applyMapping effect-param', () => {
  it('xy pad drives a point param and syncs it via modifier.update', async () => {
    applyMapping(mapping('origin'), true, { key: 'w-xy', value: 0.2, value2: 0.9 });
    expect(params().origin).toEqual({ x: 0.2, y: 0.9 });
    await flush();
    expect(dispatch).toHaveBeenCalledWith('modifier.update', { effectId: 'mod-1', changes: {}, paramChanges: { origin: { x: 0.2, y: 0.9 } } });
  });

  it('button toggles a bool param per press by default (latch)', () => {
    const m = mapping('invert');
    expect(isFlashMapping(m)).toBe(false);
    applyMapping(m, true, { key: 'w-btn' });
    expect(params().invert).toBe(true);
    applyMapping(m, false, { key: 'w-btn' });
    expect(params().invert).toBe(true);
    applyMapping(m, true, { key: 'w-btn' });
    expect(params().invert).toBe(false);
  });

  it('button holds a bool param while pressed (hold = momentary)', () => {
    const m = mapping('invert', { behavior: 'hold' });
    expect(isFlashMapping(m)).toBe(true);
    applyMapping(m, true, { key: 'w-btn' });
    expect(params().invert).toBe(true);
    applyMapping(m, false, { key: 'w-btn' });
    expect(params().invert).toBe(false);
  });

  it('slider drives a number param over its range; inputs a param cannot take are ignored', () => {
    applyMapping(mapping('gain'), true, { key: 'w-sld', value: 0.25 });
    expect(params().gain).toBe(0.5);
    // A button press cannot drive a number, a slider cannot drive a point.
    applyMapping(mapping('gain'), true, { key: 'w-btn' });
    applyMapping(mapping('origin'), true, { key: 'w-sld', value: 0.1 });
    expect(params()).toMatchObject({ gain: 0.5, origin: { x: 0.5, y: 0.5 } });
  });
});
