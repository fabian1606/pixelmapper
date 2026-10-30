/**
 * `modifiers.update` partial speed merge and the `id` → `modifierId` /
 * `modifierIds` alias on every op addressing an existing modifier
 * (update, remove, applyRecipe, trigger): conflicts, missing-id messages
 * and the JSON schema exported to MCP.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest } from '@pixelmapper/agent-kit';
import { toJsonSchema } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { applyOperations } from '../apply';
import { normalizeInputAliases } from '../input-aliases';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { modifierOperations, modifiersApplyRecipe, modifiersRemove, modifiersUpdate } from './modifiers';
import { modifiersTrigger } from './modifier-trigger';

// ── Setup ───────────────────────────────────────

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a', x: 0.1, y: 0.5 }, { id: 'fx-b', x: 0.9, y: 0.5 }]);
});

/** Runs a batch against a registry with the modifier operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...modifierOperations), actor: 'agent:test' });
}

/** Runs one op and returns the result. */
function one(op: string, input: Record<string, unknown>) {
  return apply({ label: op, ops: [{ op, input }] });
}

/** Adds a waveform modifier with id `id` and the given speed. */
async function addWave(id: string, speed?: Record<string, unknown>) {
  const res = await one('modifiers.add', { plugin: 'waveform', id, ...(speed ? { speed } : {}) });
  expect(res.findings.filter(f => f.level === 'error')).toEqual([]);
}

/** Error findings of a result. */
const errors = (res: Awaited<ReturnType<typeof apply>>) => res.findings.filter(f => f.level === 'error');

// ── Speed merge ─────────────────────────────────

describe('modifiers.update speed merge', () => {
  it('a bare value keeps the current beat mode and offset', async () => {
    await addWave('w', { mode: 'beat', value: 2, beatOffset: 0.5 });
    const before = stateFingerprint();
    const res = await one('modifiers.update', { modifierId: 'w', speed: { value: 8 } });
    expect(errors(res)).toEqual([]);
    expect(readApi.modifier('w')!.speed).toMatchObject({ mode: 'beat', beatValue: 8, beatOffset: 0.5 });
    expect(res.diff).toContainEqual({ entity: 'modifier:w', field: 'speed.value', from: 2, to: 8 });
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('a bare value in time mode sets seconds', async () => {
    await addWave('w', { mode: 'time', value: 1 });
    await one('modifiers.update', { modifierId: 'w', speed: { value: 3 } });
    expect(readApi.modifier('w')!.speed).toMatchObject({ mode: 'time', timeMs: 3000 });
  });

  it('only beatOffset keeps mode and value', async () => {
    await addWave('w', { mode: 'beat', value: 4 });
    await one('modifiers.update', { modifierId: 'w', speed: { beatOffset: 0.25 } });
    expect(readApi.modifier('w')!.speed).toMatchObject({ mode: 'beat', beatValue: 4, beatOffset: 0.25 });
  });

  it('only mode switches and keeps the stored values', async () => {
    await addWave('w', { mode: 'beat', value: 4 });
    await one('modifiers.update', { modifierId: 'w', speed: { mode: 'infinite' } });
    expect(readApi.modifier('w')!.speed).toMatchObject({ mode: 'infinite', beatValue: 4 });
    await one('modifiers.update', { modifierId: 'w', speed: { mode: 'beat' } });
    expect(readApi.modifier('w')!.speed).toMatchObject({ mode: 'beat', beatValue: 4 });
  });

  it('rejects a value on a frozen (infinite) modifier and rolls back', async () => {
    await addWave('w', { mode: 'infinite' });
    const before = stateFingerprint();
    const res = await one('modifiers.update', { modifierId: 'w', speed: { value: 2 } });
    expect(res.committed).toBe(false);
    expect(errors(res)[0]!.message).toMatch(/infinite mode.*pass speed\.mode "beat" or "time"/);
    expect(stateFingerprint()).toBe(before);
  });

  it('still validates each given key', async () => {
    await addWave('w');
    const res = await one('modifiers.update', { modifierId: 'w', speed: { value: -1 } });
    expect(errors(res)[0]).toMatchObject({ code: 'invalid-input' });
    expect(errors(res)[0]!.message).toMatch(/speed\.value/);
  });
});

// ── id alias ────────────────────────────────────

describe('modifierId alias `id`', () => {
  it('update, applyRecipe and remove accept `id`', async () => {
    await addWave('w');
    expect(errors(await one('modifiers.update', { id: 'w', speed: { value: 2 } }))).toEqual([]);
    expect(readApi.modifier('w')!.speed.beatValue).toBe(2);
    expect(errors(await one('modifiers.applyRecipe', { id: 'w', recipe: 'chase' }))).toEqual([]);
    expect(errors(await one('modifiers.remove', { id: 'w' }))).toEqual([]);
    expect(readApi.modifier('w')).toBeNull();
  });

  it('accepts both keys when they name the same modifier', async () => {
    await addWave('w');
    expect(errors(await one('modifiers.update', { modifierId: 'w', id: 'w', strength: 0.4 }))).toEqual([]);
    expect(readApi.modifier('w')!.strength).toBe(0.4);
    expect(errors(await one('modifiers.remove', { modifierIds: ['w'], id: 'w' }))).toEqual([]);
  });

  it('rejects differing `modifierId` and `id` on every op', async () => {
    await addWave('a');
    await addWave('b');
    const before = stateFingerprint();
    const cases: [string, Record<string, unknown>][] = [
      ['modifiers.update', { modifierId: 'a', id: 'b', strength: 0.5 }],
      ['modifiers.applyRecipe', { modifierId: 'a', id: 'b', recipe: 'chase' }],
      ['modifiers.trigger', { modifierId: 'a', id: 'b', paramKey: 'hit', action: 'click' }],
      ['modifiers.remove', { modifierIds: ['a'], id: 'b' }],
      ['modifiers.remove', { modifierId: 'a', id: 'b' }],
    ];
    for (const [op, input] of cases) {
      const res = await one(op, input);
      expect(res.committed, op).toBe(false);
      expect(errors(res)[0], op).toMatchObject({ code: 'invalid-input' });
      expect(errors(res)[0]!.message, op).toMatch(/name different modifiers/);
    }
    expect(stateFingerprint()).toBe(before);
  });

  it('names the accepted keys when the id is missing', async () => {
    for (const op of ['modifiers.update', 'modifiers.applyRecipe', 'modifiers.trigger']) {
      const res = await one(op, { recipe: 'chase', paramKey: 'hit', action: 'click' });
      expect(errors(res)[0]!.message, op).toContain('pass `modifierId` (or its alias `id`)');
    }
    const res = await one('modifiers.remove', {});
    expect(errors(res)[0]!.message).toContain('pass `modifierIds` (or a single `modifierId` / `id` as alias)');
  });
});

// ── normalizeInputAliases ───────────────────────

describe('normalizeInputAliases', () => {
  it('renames `id` and lifts single ids into lists', () => {
    expect(normalizeInputAliases(modifiersUpdate.input, { id: 'w', strength: 1 })).toEqual({ ok: true, input: { modifierId: 'w', strength: 1 } });
    expect(normalizeInputAliases(modifiersRemove.input, { modifierId: 'w' })).toEqual({ ok: true, input: { modifierIds: ['w'] } });
    expect(normalizeInputAliases(modifiersRemove.input, { id: ['a', 'b'] })).toEqual({ ok: true, input: { modifierIds: ['a', 'b'] } });
  });

  it('leaves schemas with their own `id` key alone', () => {
    const add = modifierOperations.find(o => o.id === 'modifiers.add')!;
    expect(normalizeInputAliases(add.input, { id: 'x', plugin: 'waveform' })).toEqual({ ok: true, input: { id: 'x', plugin: 'waveform' } });
  });
});

// ── JSON schema (MCP) ───────────────────────────

describe('exported JSON schema', () => {
  it('keeps plain object schemas with the canonical keys and the alias in the description', () => {
    for (const op of [modifiersUpdate, modifiersApplyRecipe, modifiersTrigger]) {
      const json = toJsonSchema(op.input) as { type: string; required: string[]; properties: Record<string, { type?: string; description?: string }> };
      expect(json.type, op.id).toBe('object');
      expect(json.required, op.id).toContain('modifierId');
      expect(json.properties.modifierId!.type, op.id).toBe('string');
      expect(json.properties.modifierId!.description, op.id).toMatch(/Alias: "id"/);
    }
    const remove = toJsonSchema(modifiersRemove.input) as { required: string[] };
    expect(remove.required).toEqual(['modifierIds']);
  });

  it('marks every speed key optional', () => {
    const json = toJsonSchema(modifiersUpdate.input) as { properties: { speed: { type: string; required?: string[]; properties: Record<string, unknown> } } };
    expect(json.properties.speed.type).toBe('object');
    expect(json.properties.speed.required ?? []).toEqual([]);
    expect(Object.keys(json.properties.speed.properties)).toEqual(['mode', 'value', 'beatOffset']);
  });
});
