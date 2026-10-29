/**
 * `modifiers.*` operations: effect, one undo step back to the exact
 * pre-state, dry runs, verify rollbacks and the semantic diff. Built-in
 * plugin manifests are embedded (`builtin-index.ts`), so no build is needed.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApplyRequest } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { BUILTIN_ALIASES, builtinHash } from '~/utils/engine/modifiers';
import { getManifest } from '~/utils/plugins/plugin-store';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { modifierOperations } from './modifiers';

const WAVEFORM = builtinHash(BUILTIN_ALIASES.waveform);
const COLOR = builtinHash(BUILTIN_ALIASES.colorAdjust);

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene(
    [{ id: 'fx-a', x: 0.1, y: 0.5 }, { id: 'fx-b', x: 0.5, y: 0.5 }, { id: 'fx-c', x: 0.9, y: 0.5 }],
    [{ id: 'g-left', name: 'Left', fixtureIds: ['fx-a', 'fx-b'] }, { id: 'g-empty', name: 'Empty', fixtureIds: [] }],
  );
});

/** Runs a batch against a registry with the modifier operations. */
function apply(request: ApplyRequest) {
  return applyOperations(request, { registry: registryWith(...modifierOperations), actor: 'agent:test' });
}

/** Adds a modifier and returns its id. */
async function add(input: Record<string, unknown>): Promise<string> {
  const res = await apply({ label: 'Add', ops: [{ op: 'modifiers.add', input }] });
  expect(res.findings.filter(f => f.level === 'error')).toEqual([]);
  expect(res.committed).toBe(true);
  return (res.results[0]!.value as { modifierId: string }).modifierId;
}

/** Asserts that undoing the last step restores `before`. */
function expectUndoRestores(before: string) {
  useHistory().undo();
  expect(stateFingerprint()).toBe(before);
}

describe('modifiers.add', () => {
  it('adds a built-in by short alias with recipe, spread and speed; undo restores', async () => {
    const before = stateFingerprint();
    const res = await apply({
      label: 'Chase',
      ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', recipe: 'chase', targets: { groupIds: ['g-left'] }, speed: { mode: 'beat', value: 4 }, strength: 0.5 } }],
    });
    expect(res.committed).toBe(true);
    const id = (res.results[0]!.value as { modifierId: string }).modifierId;
    const m = readApi.modifier(id)!;
    expect(m.plugin).toBe(WAVEFORM);
    expect(m.signature).toBe('scalar');
    expect(m.targetFixtureIds).toEqual(['fx-a', 'fx-b']);
    expect(m.targetChannels).toEqual(['DIMMER']);
    expect(m.speed).toMatchObject({ mode: 'beat', beatValue: 4 });
    expect(m.strength).toBe(0.5);
    expect(m.blendMode).toBe('add');
    expect(res.diff).toContainEqual(expect.objectContaining({ entity: `modifier:${id}`, field: 'added' }));
    expect(useHistory().lastDescription.value).toBe('AI: Chase');
    expectUndoRestores(before);
  });

  it('defaults like the card: all fixtures offering the signature, absolute output overrides, recipe placed on targets', async () => {
    const id = await add({ plugin: '@pixelmapper/color-adjust' });
    const m = readApi.modifier(id)!;
    expect(m.plugin).toBe(COLOR);
    expect(m.signature).toBe('rgb');
    expect(m.targetFixtureIds).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(m.targetChannels).toEqual(['RED', 'GREEN', 'BLUE']);
    expect(m.blendMode).toBe('override');
    // Recipe handle placed along the targets' main axis (x 0.1 → 0.9).
    expect(m.distribution.origin.x).toBeCloseTo(0.1);
    expect(m.distribution.end.x).toBeCloseTo(0.9);
  });

  it('translates spatial / order / within spreads and params', async () => {
    const spatial = await add({ plugin: 'waveform', spread: { type: 'spatial', mode: 'radial', origin: { x: 0.5, y: 0.5 }, end: { x: 0.8, y: 0.5 }, reverse: true } });
    expect(readApi.modifier(spatial)!.distribution).toMatchObject({ scope: 'across', mode: 'radial', origin: { x: 0.5, y: 0.5 }, end: { x: 0.8, y: 0.5 }, reverse: true });

    const order = await add({ plugin: 'waveform', spread: { type: 'order', fixtureOrder: ['fx-c', 'fx-a', 'fx-b'] }, params: { invert: true } });
    const om = readApi.modifier(order)!;
    expect(om.distribution).toMatchObject({ scope: 'across', mode: 'order', order: { ranks: { 'fx-c': 0, 'fx-a': 1, 'fx-b': 2 } } });
    expect(om.params.invert).toBe(true);

    const within = await add({ plugin: 'noise', spread: { type: 'within' } });
    expect(readApi.modifier(within)!.distribution.scope).toBe('within');

    const list = await apply({ label: 'list', ops: [{ op: 'modifiers.list', input: {} }] });
    const views = (list.results[0]!.value as { modifiers: { id: string; spread: { type: string; ranks?: Record<string, number> } }[] }).modifiers;
    expect(views.map(v => v.spread.type)).toEqual(['spatial', 'order', 'within']);
    expect(views[1]!.spread.ranks).toEqual({ 'fx-c': 0, 'fx-a': 1, 'fx-b': 2 });
  });

  it('inserts at an index (default: top)', async () => {
    const a = await add({ plugin: 'waveform' });
    const b = await add({ plugin: 'noise' });
    const c = await add({ plugin: 'sequencer', index: 0 });
    expect(readApi.modifiers().map(m => m.id)).toEqual([c, a, b]);
  });

  it('dry run leaves state and history untouched but reports the diff', async () => {
    const before = stateFingerprint();
    const res = await apply({ label: 'Try', dryRun: true, ops: [{ op: 'modifiers.add', input: { plugin: 'waveform' } }] });
    expect(res.committed).toBe(false);
    expect(res.diff.some(c => c.field === 'added' && c.entity.startsWith('modifier:'))).toBe(true);
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('rolls back on unknown plugin, empty targets and invalid params', async () => {
    const before = stateFingerprint();
    const unknown = await apply({ label: 'x', ops: [{ op: 'modifiers.add', input: { plugin: 'nope' } }] });
    expect(unknown.findings[0]).toMatchObject({ level: 'error', code: 'operation-failed' });
    expect(unknown.findings[0]!.message).toMatch(/plugin "nope" not found/);

    const empty = await apply({ label: 'x', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', targets: { groupIds: ['g-empty'] } } }] });
    expect(empty.committed).toBe(false);
    expect(empty.findings).toContainEqual(expect.objectContaining({ level: 'error', code: 'no-targets' }));

    const badParam = await apply({ label: 'x', ops: [{ op: 'modifiers.add', input: { plugin: 'noise', params: { rangeMin: 3, bogus: 1 } } }] });
    expect(badParam.committed).toBe(false);
    const codes = badParam.findings.filter(f => f.code === 'invalid-param').map(f => f.message);
    expect(codes.some(m => m.includes('rangeMin') && m.includes('0–1'))).toBe(true);
    expect(codes.some(m => m.includes('unknown param "bogus"'))).toBe(true);

    const badSpread = await apply({ label: 'x', ops: [{ op: 'modifiers.add', input: { plugin: 'sequencer', spread: { type: 'same' } } }] });
    expect(badSpread.findings).toContainEqual(expect.objectContaining({ code: 'spread-not-offered' }));

    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('accepts the default params of every built-in', async () => {
    for (const alias of Object.keys(BUILTIN_ALIASES)) await add({ plugin: alias });
    expect(readApi.modifiers()).toHaveLength(Object.keys(BUILTIN_ALIASES).length);
  });
});

describe('modifiers.update / remove / reorder / applyRecipe', () => {
  it('update merges params and lists changed fields in the diff; undo restores', async () => {
    const id = await add({ plugin: 'noise', recipe: 'candle' });
    const old = readApi.modifier(id)!;
    const before = stateFingerprint();
    const res = await apply({ label: 'Tweak', ops: [{ op: 'modifiers.update', input: { modifierId: id, params: { rangeMin: 0.2 }, speed: { mode: 'time', value: 1.5 }, blend: 'max' } }] });
    expect(res.committed).toBe(true);
    const m = readApi.modifier(id)!;
    expect(m.params.rangeMin).toBe(0.2);
    expect(m.params.rangeMax).toBe(old.params.rangeMax);
    expect(m.speed).toMatchObject({ mode: 'time', timeMs: 1500 });
    expect(m.blendMode).toBe('max');
    expect(res.diff).toContainEqual({ entity: `modifier:${id}`, field: 'params.rangeMin', from: old.params.rangeMin, to: 0.2 });
    expect(res.diff).toContainEqual({ entity: `modifier:${id}`, field: 'speed.timeMs', from: old.speed.timeMs, to: 1500 });
    expectUndoRestores(before);
  });

  it('update replaces targets and switches spread keeping other fields', async () => {
    const id = await add({ plugin: 'waveform' });
    await apply({ label: 'u', ops: [{ op: 'modifiers.update', input: { modifierId: id, targets: { fixtureIds: ['fx-c'] }, spread: { type: 'same' } } }] });
    const m = readApi.modifier(id)!;
    expect(m.targetFixtureIds).toEqual(['fx-c']);
    expect(m.distribution.mode).toBe('none');
  });

  it('update with an invalid param rolls back', async () => {
    const id = await add({ plugin: 'colorAdjust' });
    const before = stateFingerprint();
    const res = await apply({ label: 'u', ops: [{ op: 'modifiers.update', input: { modifierId: id, params: { mode: 'disco' } } }] });
    expect(res.committed).toBe(false);
    expect(res.findings[0]).toMatchObject({ code: 'invalid-param' });
    expect(res.findings[0]!.message).toMatch(/palette, shift/);
    expect(stateFingerprint()).toBe(before);
  });

  it('remove deletes instances; undo restores', async () => {
    const a = await add({ plugin: 'waveform' });
    const b = await add({ plugin: 'noise' });
    const before = stateFingerprint();
    const res = await apply({ label: 'rm', ops: [{ op: 'modifiers.remove', input: { modifierIds: [a] } }] });
    expect(readApi.modifiers().map(m => m.id)).toEqual([b]);
    expect(res.diff).toContainEqual(expect.objectContaining({ entity: `modifier:${a}`, field: 'removed' }));
    expectUndoRestores(before);
    const missing = await apply({ label: 'rm', ops: [{ op: 'modifiers.remove', input: { modifierIds: ['nope'] } }] });
    expect(missing.findings[0]!.message).toMatch(/modifier "nope" not found/);
  });

  it('reorder takes a full permutation; undo restores', async () => {
    const a = await add({ plugin: 'waveform' });
    const b = await add({ plugin: 'noise' });
    const before = stateFingerprint();
    const res = await apply({ label: 'ro', ops: [{ op: 'modifiers.reorder', input: { order: [b, a] } }] });
    expect(readApi.modifiers().map(m => m.id)).toEqual([b, a]);
    expect(res.diff).toContainEqual({ entity: `modifier:${a}`, field: 'index', from: 0, to: 1 });
    expectUndoRestores(before);
    const partial = await apply({ label: 'ro', ops: [{ op: 'modifiers.reorder', input: { order: [a] } }] });
    expect(partial.findings[0]!.message).toMatch(/missing/);
  });

  it('applyRecipe applies a recipe by id or label; undo restores', async () => {
    const id = await add({ plugin: 'waveform', recipe: 'chase' });
    const before = stateFingerprint();
    const res = await apply({ label: 'rec', ops: [{ op: 'modifiers.applyRecipe', input: { modifierId: id, recipe: 'Ping-Pong' } }] });
    expect(res.committed).toBe(true);
    expect(res.results[0]!.value).toEqual({ modifierId: id, recipe: 'ping-pong' });
    const preset = getManifest(WAVEFORM)!.presets!.find(p => p.id === 'ping-pong')!;
    if (preset.speed?.beatValue) expect(readApi.modifier(id)!.speed.beatValue).toBe(preset.speed.beatValue);
    const list = await apply({ label: 'l', ops: [{ op: 'modifiers.list', input: { fixtureId: 'fx-a' } }] });
    expect((list.results[0]!.value as { modifiers: { recipe: string | null }[] }).modifiers[0]!.recipe).toBe('ping-pong');
    expectUndoRestores(before);
    const bad = await apply({ label: 'rec', ops: [{ op: 'modifiers.applyRecipe', input: { modifierId: id, recipe: 'nope' } }] });
    expect(bad.findings[0]!.message).toMatch(/no recipe "nope".*chase/);
  });

  it('a batch of add + update is one undo step', async () => {
    const before = stateFingerprint();
    const res = await apply({
      label: 'Batch',
      ops: [
        { op: 'modifiers.add', input: { plugin: 'waveform' } },
        { op: 'modifiers.list', input: {} },
      ],
    });
    expect(res.committed).toBe(true);
    expect((res.results[1]!.value as { modifiers: unknown[] }).modifiers).toHaveLength(1);
    expect(useEngineStore().modifiers).toHaveLength(1);
    expectUndoRestores(before);
    expect(useHistory().canUndo.value).toBe(false);
  });
});
