/**
 * `modifiers.trigger` (action) and the `id` → `modifierId` input alias:
 * press / release / click through `setEffectTrigger`, engine-clock
 * timestamps, no undo step, validation errors, dry-run skip.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyRequest } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import type { ModifierInstance } from '~/utils/engine/types';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stubOperationGlobals } from '../test-utils';
import { modifierOperations } from './modifiers';

// ── Setup ───────────────────────────────────────

/** Manifest of the `sha256:flash` test plugin: a trigger `hit` and a number `level`. */
const FLASH = vi.hoisted(() => ({
  hash: 'sha256:flash',
  manifest: {
    name: 'Flash',
    signatures: ['rgb'],
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

/** Engine clock epoch of the tests; `Date.now()` is pinned 5 s later. */
const EPOCH = 1_000_000;
const NOW = EPOCH + 5000;

/** A flash modifier instance with an idle trigger. */
function flashModifier(id: string): ModifierInstance {
  return {
    id,
    plugin: FLASH.hash,
    signature: 'rgb',
    targetChannels: [],
    blendMode: 'add',
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    distribution: {} as ModifierInstance['distribution'],
    params: { hit: { pressed: false }, level: 1 },
  };
}

/** Replaces the stack in place (keeps the engine's array, which commands write). */
function setStack(list: ModifierInstance[]): void {
  const store = useEngineStore();
  store.modifiers.splice(0, store.modifiers.length, ...list);
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  seedScene([{ id: 'fx-a' }]);
  const store = useEngineStore();
  store.clockEpoch = EPOCH;
  setStack([flashModifier('fl-1')]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs a batch against a registry with the modifier operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...modifierOperations), actor: 'agent:test' });
}

/** Stored trigger value of `fl-1`. */
const hit = () => readApi.modifier('fl-1')?.params.hit;

// ── modifiers.trigger ───────────────────────────

describe('modifiers.trigger', () => {
  it('presses and releases with engine-clock timestamps and no undo step', async () => {
    const press = await apply({ label: 'Press', ops: [{ op: 'modifiers.trigger', input: { modifierId: 'fl-1', paramKey: 'hit', action: 'press' } }] });
    expect(press.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(press.committed).toBe(false);
    expect(press.results[0]).toMatchObject({ kind: 'action', value: { engineTimeMs: 5000, wallTimeMs: NOW, changed: true, value: { pressed: true, pressedAt: 5000, clicks: 1 } } });
    expect(hit()).toEqual({ pressed: true, pressedAt: 5000, clicks: 1 });
    expect(press.diff).toContainEqual(expect.objectContaining({ entity: 'modifier:fl-1' }));

    vi.spyOn(Date, 'now').mockReturnValue(NOW + 800);
    const release = await apply({ label: 'Release', ops: [{ op: 'modifiers.trigger', input: { modifierId: 'fl-1', paramKey: 'hit', action: 'release' } }] });
    expect(release.results[0]!.value).toMatchObject({ engineTimeMs: 5800, value: { pressed: false, pressedAt: 5000, releasedAt: 5800 } });
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('click with clicks: 2 sends a double-click burst at one instant', async () => {
    const res = await apply({ label: 'Double', ops: [{ op: 'modifiers.trigger', input: { modifierId: 'fl-1', paramKey: 'params.hit', action: 'click', clicks: 2 } }] });
    expect(res.results[0]!.value).toMatchObject({ paramKey: 'hit', engineTimeMs: 5000, value: { pressed: false, clicks: 2, pressedAt: 5000, releasedAt: 5000 } });
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('reports an unchanged edge as info, not as an error', async () => {
    const res = await apply({ label: 'Release idle', ops: [{ op: 'modifiers.trigger', input: { modifierId: 'fl-1', paramKey: 'hit', action: 'release' } }] });
    expect(res.results[0]!.value).toMatchObject({ changed: false });
    expect(res.findings).toEqual([expect.objectContaining({ level: 'info', code: 'trigger-unchanged' })]);
  });

  it('accepts `id` as alias for modifierId', async () => {
    const res = await apply({ label: 'Alias', ops: [{ op: 'modifiers.trigger', input: { id: 'fl-1', paramKey: 'hit', action: 'click' } }] });
    expect(res.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(hit()).toMatchObject({ pressed: false, clicks: 1 });
  });

  it('rejects unknown modifiers, unknown params and non-trigger params with readable errors', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ modifierId: 'nope', paramKey: 'hit', action: 'press' }, /modifier "nope" not found/],
      [{ modifierId: 'fl-1', paramKey: 'boom', action: 'press' }, /no param "boom" \(trigger params: hit\)/],
      [{ modifierId: 'fl-1', paramKey: 'level', action: 'press' }, /is a number param, not a trigger/],
      [{ modifierId: 'fl-1', paramKey: 'hit', action: 'press', clicks: 2 }, /clicks is only valid with action "click"/],
      [{ paramKey: 'hit', action: 'press' }, /modifierId: required: pass the modifier id as "modifierId"/],
    ];
    for (const [input, message] of cases) {
      const res = await apply({ label: 'Bad', ops: [{ op: 'modifiers.trigger', input }] });
      expect(res.findings[0]?.level, JSON.stringify(input)).toBe('error');
      expect(res.findings[0]!.message).toMatch(message);
    }
    expect(hit()).toEqual({ pressed: false });
  });

  it('is skipped on dry runs', async () => {
    const res = await apply({ label: 'Dry', dryRun: true, ops: [{ op: 'modifiers.trigger', input: { modifierId: 'fl-1', paramKey: 'hit', action: 'press' } }] });
    expect(res.results[0]).toMatchObject({ kind: 'action', skipped: true });
    expect(hit()).toEqual({ pressed: false });
  });
});

// ── id alias on other ops ───────────────────────

describe('modifierId alias', () => {
  it('modifiers.update accepts `id`; one undo step restores the value', async () => {
    await apply({ label: 'Add', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', id: 'wv' } }] });
    const res = await apply({ label: 'Strength', ops: [{ op: 'modifiers.update', input: { id: 'wv', strength: 0.5 } }] });
    expect(res.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(res.committed).toBe(true);
    expect(readApi.modifier('wv')?.strength).toBe(0.5);
    useHistory().undo();
    expect(readApi.modifier('wv')?.strength).toBe(1);
  });

  it('modifiers.remove accepts a single `modifierId` or `id`', async () => {
    setStack([flashModifier('fl-1'), flashModifier('fl-2')]);
    const res = await apply({ label: 'Remove', ops: [{ op: 'modifiers.remove', input: { modifierId: 'fl-1' } }, { op: 'modifiers.remove', input: { id: 'fl-2' } }] });
    expect(res.findings.filter(f => f.level === 'error')).toEqual([]);
    expect(readApi.modifiers()).toEqual([]);
  });

  it('names the canonical key when the id is missing', async () => {
    const res = await apply({ label: 'Missing', ops: [{ op: 'modifiers.applyRecipe', input: { recipe: 'x' } }] });
    expect(res.findings[0]).toMatchObject({ level: 'error', code: 'invalid-input' });
    expect(res.findings[0]!.message).toContain('modifierId: required: pass the modifier id as "modifierId" ("id" is accepted as alias');
  });
});
