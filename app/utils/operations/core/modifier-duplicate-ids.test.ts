/**
 * Duplicate modifier ids (two instances sharing one id): the root-cause fix
 * in preset apply, the load-time repair in `deserializeProject`, and the
 * `modifiers.*` ops (list warns, ops addressing the id fail as ambiguous).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest } from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import { applyPreset } from '~/components/engine/composables/preset-apply';
import { BUILTIN_ALIASES, builtinHash, createModifier, dedupeModifierIds, duplicateModifierIds } from '~/utils/engine/modifiers';
import type { Preset } from '~/utils/engine/preset-types';
import { deserializeProject, SCHEMA_VERSION, type ProjectSnapshot } from '~/utils/engine/serialize';
import type { ModifierInstance } from '~/utils/engine/types';
import { applyOperations } from '../apply';
import { registryWith, resetOperationState, seedScene, stubOperationGlobals } from '../test-utils';
import { modifierOperations } from './modifiers';

const NOISE = builtinHash(BUILTIN_ALIASES.noise);

/** A noise instance with id `id` on `fixtureIds` (dimmer targets). */
function twinkle(id: string, fixtureIds: string[]): ModifierInstance {
  return { ...createModifier(NOISE, { targetChannels: ['DIMMER'], targetFixtureIds: fixtureIds }), id };
}

/** `n` fixture ids `fx-<start>`…. */
function ids(start: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `fx-${start + i}`);
}

/** A preset with one dimmer category per entry (each holding `mod`). */
function presetWith(mod: ModifierInstance, categories: string[][]): Preset {
  return {
    id: 'p1',
    name: 'P1',
    createdAt: '2026-01-01',
    categories: categories.map(fixtureIds => ({ type: 'dimmer', label: 'Dimmer', fixtureIds, channels: [], modifiers: [{ ...mod, targetFixtureIds: [] }], isModifier: true })),
  } as Preset;
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a', x: 0.1, y: 0.5 }, { id: 'fx-b', x: 0.9, y: 0.5 }]);
});

// ── Root cause: preset apply ────────────────────

describe('applyPreset (preset → live modifiers)', () => {
  it('gives a fresh id when a live instance outside the preset already uses the snapshot id', () => {
    // Live "twinkle" on fixtures 13–22 survives the clear (no overlap); the
    // preset holds the same instance id on fixtures 1–12.
    const effects = [twinkle('twinkle', ids(13, 10))];
    applyPreset(presetWith(twinkle('twinkle', []), [ids(1, 12)]), [], effects);
    expect(effects).toHaveLength(2);
    expect(duplicateModifierIds(effects).size).toBe(0);
    expect(effects[0]!.id).toBe('twinkle');
  });

  it('gives a fresh id when one snapshot id appears in two categories', () => {
    const effects: ModifierInstance[] = [];
    applyPreset(presetWith(twinkle('twinkle', []), [ids(1, 12), ids(13, 10)]), [], effects);
    expect(effects.map(e => e.targetFixtureIds?.length)).toEqual([12, 10]);
    expect(duplicateModifierIds(effects).size).toBe(0);
  });

  it('keeps the snapshot id when it is free (preset diff matches it)', () => {
    const effects: ModifierInstance[] = [];
    applyPreset(presetWith(twinkle('twinkle', []), [ids(1, 12)]), [], effects);
    expect(effects.map(e => e.id)).toEqual(['twinkle']);
  });
});

// ── Load-time repair ────────────────────────────

describe('deserializeProject', () => {
  it('gives later duplicates fresh ids and keeps the first occurrence', () => {
    const snapshot: ProjectSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      sceneNodes: [],
      savedPresets: [],
      pinnedModifiers: [],
      globalBases: {},
      modifiers: [twinkle('twinkle', ids(1, 12)), twinkle('twinkle', ids(13, 10)), twinkle('other', [])],
    };
    const { modifiers } = deserializeProject(snapshot);
    expect(modifiers[0]!.id).toBe('twinkle');
    expect(modifiers[0]!.targetFixtureIds).toHaveLength(12);
    expect(modifiers[1]!.id).not.toBe('twinkle');
    expect(modifiers[2]!.id).toBe('other');
    expect(duplicateModifierIds(modifiers).size).toBe(0);
    // The input snapshot is not mutated.
    expect(snapshot.modifiers[1]!.id).toBe('twinkle');
  });

  it('dedupeModifierIds reports the number of renamed instances', () => {
    expect(dedupeModifierIds([twinkle('a', []), twinkle('a', []), twinkle('a', []), twinkle('b', [])])).toBe(2);
  });
});

// ── Operations ──────────────────────────────────

/** Runs a batch against a registry with the modifier operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...modifierOperations), actor: 'agent:test' });
}

describe('modifiers.* with a duplicated id', () => {
  beforeEach(() => {
    useEngineStore().engine.setModifiers([twinkle('twinkle', ['fx-a']), twinkle('twinkle', ['fx-b']), twinkle('solo', ['fx-a'])]);
  });

  it('modifiers.list flags the duplicate ids with a warning', async () => {
    const res = await apply({ label: 'list', ops: [{ op: 'modifiers.list', input: {} }] });
    const value = res.results[0]!.value as { warnings?: string[]; duplicateIds?: { id: string; count: number }[]; modifiers: unknown[] };
    expect(value.modifiers).toHaveLength(3);
    expect(value.duplicateIds).toEqual([{ id: 'twinkle', count: 2 }]);
    expect(value.warnings).toHaveLength(1);
    expect(value.warnings![0]).toMatch(/modifier id "twinkle" is shared by 2 instances/);
  });

  it('modifiers.list has no warnings for a consistent stack', async () => {
    useEngineStore().engine.setModifiers([twinkle('solo', ['fx-a'])]);
    const res = await apply({ label: 'list', ops: [{ op: 'modifiers.list', input: {} }] });
    expect(res.results[0]!.value).not.toHaveProperty('warnings');
    expect(res.results[0]!.value).not.toHaveProperty('duplicateIds');
  });

  it.each([
    ['modifiers.update', { modifierId: 'twinkle', strength: 0.5 }],
    ['modifiers.remove', { modifierIds: ['twinkle'] }],
    ['modifiers.applyRecipe', { modifierId: 'twinkle', recipe: 'candle' }],
    ['modifiers.reorder', { order: ['solo', 'twinkle'] }],
  ])('%s fails clearly on the ambiguous id', async (op, input) => {
    const res = await apply({ label: op, ops: [{ op, input }] });
    expect(res.committed).toBe(false);
    expect(res.findings[0]!.message).toMatch(/modifier id "twinkle" is ambiguous: 2 instances share it/);
    expect(useEngineStore().modifiers).toHaveLength(3);
  });

  it('ops on a unique id still work', async () => {
    const res = await apply({ label: 'u', ops: [{ op: 'modifiers.update', input: { modifierId: 'solo', strength: 0.5 } }] });
    expect(res.committed).toBe(true);
  });
});
