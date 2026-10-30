/**
 * project.*, fixtures.*, nodes.rename, groups/selection, extensionData.set,
 * channels.set: execute + undo restores state; catalog checks.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useHistory } from '~/components/engine/composables/use-history';
import { useEngineStore } from '~/stores/engine-store';
import { Beam } from '~/utils/engine/core/beam';
import { applyOperations } from '../apply';
import { readApi } from '../read-api';
import { createOperationRegistry } from '../registry';
import { resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '../test-utils';
import { CORE_OPERATIONS, registerCoreOperations } from './index';

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene(
    [{ id: 'fx-a', x: 0.1, y: 0.2 }, { id: 'fx-b', x: 0.5, y: 0.5 }, { id: 'fx-c', x: 0.9, y: 0.8, z: 0.3 }],
    [{ id: 'g-front', name: 'Front', fixtureIds: ['fx-a', 'fx-b'] }],
  );
});

const registry = () => registerCoreOperations(createOperationRegistry());

/** Applies one op, asserts commit, then undo restores the fingerprint. */
async function applyAndUndo(op: string, input: unknown, check: () => void) {
  const before = stateFingerprint();
  const result = await applyOperations({ label: op, ops: [{ op, input }] }, { registry: registry(), actor: 'agent:test' });
  expect(result.findings.filter(f => f.level === 'error')).toEqual([]);
  expect(result.committed).toBe(true);
  check();
  useHistory().undo();
  expect(stateFingerprint()).toBe(before);
  return result;
}

describe('core catalog', () => {
  it('registers every core operation with a unique id, description and schemas', () => {
    const reg = registry();
    expect(reg.all().length).toBe(CORE_OPERATIONS.length);
    for (const def of CORE_OPERATIONS) {
      const d = reg.describe(def.id)!;
      expect(d.summary.length, def.id).toBeGreaterThan(10);
      expect(d.inputSchema.type, def.id).toBe('object');
      if (def.kind === 'mutation') expect(def.produces?.length ?? 0, def.id).toBeGreaterThanOrEqual(0);
    }
    // Idempotent registration.
    expect(() => registerCoreOperations(reg)).not.toThrow();
    expect(reg.list().map(s => s.id)).toEqual(expect.arrayContaining([
      'project.digest', 'project.setBpm', 'fixtures.find', 'fixtures.get', 'fixtures.move', 'fixtures.rotate',
      'nodes.rename', 'fixtures.setKindConfig', 'extensionData.set', 'channels.set', 'groups.list', 'selection.get',
      'modifiers.list', 'modifiers.add', 'modifiers.update', 'modifiers.remove', 'modifiers.reorder', 'modifiers.applyRecipe', 'modifiers.trigger',
      'plugins.list', 'plugins.get', 'plugins.build', 'plugins.publish',
      'live.listPages', 'live.addPage', 'live.addWidget', 'live.updateWidget', 'live.removeWidget',
    ]));
  });
});

describe('queries', () => {
  it('project.digest summarizes fixtures, groups and bpm', async () => {
    const r = await applyOperations({ label: 'q', ops: [{ op: 'project.digest', input: {} }] }, { registry: registry() });
    const digest = r.results[0]!.value as { bpm: number; fixtures: { id: string; z: number; groupIds: string[] }[]; groups: { fixtureCount: number }[] };
    expect(digest.bpm).toBe(120);
    expect(digest.fixtures.map(f => f.id)).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(digest.fixtures[0]!.groupIds).toEqual(['g-front']);
    expect(digest.fixtures[2]!.z).toBe(0.3);
    expect(digest.groups[0]!.fixtureCount).toBe(2);
  });

  it('fixtures.find filters by group, signature, name and bbox; fixtures.get returns channels', async () => {
    const r = await applyOperations({
      label: 'q',
      ops: [
        { op: 'fixtures.find', input: { groupId: 'g-front' } },
        { op: 'fixtures.find', input: { signature: 'rgb', bbox: { minX: 0.4, minY: 0, maxX: 1, maxY: 1 } } },
        { op: 'fixtures.find', input: { name: 'FX-C', channelType: 'DIMMER' } },
        { op: 'fixtures.get', input: { ids: ['fx-a', 'nope'] } },
      ],
    }, { registry: registry() });
    const ids = (i: number) => (r.results[i]!.value as { fixtures: { id: string }[] }).fixtures.map(f => f.id);
    expect(ids(0)).toEqual(['fx-a', 'fx-b']);
    expect(ids(1)).toEqual(['fx-b', 'fx-c']);
    expect(ids(2)).toEqual(['fx-c']);
    const got = r.results[3]!.value as { fixtures: { detail: { channels: unknown[] } }[]; missing: string[] };
    expect(got.fixtures[0]!.detail.channels).toHaveLength(4);
    expect(got.missing).toEqual(['nope']);
  });

  it('fixtures.get lists each head with its world position (rotation applied)', async () => {
    const f = useEngineStore().flatFixtures.find(x => x.id === 'fx-a')!;
    // Three pixels along the fixture's local x axis, each owning one channel.
    f.beams = [-1, 0, 1].map((dx, h) => new Beam(`px-${h}`, dx, 0));
    f.channels.slice(0, 3).forEach((c, h) => { c.beamId = `px-${h}`; });
    const get = async () => {
      const r = await applyOperations({ label: 'q', ops: [{ op: 'fixtures.get', input: { ids: ['fx-a'] } }] }, { registry: registry() });
      return (r.results[0]!.value as { fixtures: { x: number; y: number; detail: { heads: { head: number; beamId?: string; x: number; y: number }[] } }[] }).fixtures[0]!;
    };
    const flat = await get();
    expect(flat.detail.heads.map(h => h.beamId)).toEqual(['px-0', 'px-1', 'px-2']);
    // Unrotated: pixels spread along world x around the fixture, same y.
    expect(flat.detail.heads[0]!.x).toBeLessThan(flat.x);
    expect(flat.detail.heads[2]!.x).toBeGreaterThan(flat.x);
    expect(flat.detail.heads[1]!.x).toBeCloseTo(flat.x, 3);
    expect(flat.detail.heads[0]!.y).toBeCloseTo(flat.y, 3);
    // Rotated 90° clockwise: the run goes top → bottom (+y), x stays.
    f.rotation = 90;
    const turned = await get();
    expect(turned.detail.heads[0]!.y).toBeLessThan(turned.y);
    expect(turned.detail.heads[2]!.y).toBeGreaterThan(turned.y);
    expect(turned.detail.heads[0]!.x).toBeCloseTo(turned.x, 3);
  });

  it('groups.list and selection.get', async () => {
    useEngineStore().selectedIds = new Set(['g-front']);
    const r = await applyOperations({ label: 'q', ops: [{ op: 'groups.list', input: {} }, { op: 'selection.get', input: {} }] }, { registry: registry() });
    expect(r.results[0]!.value).toEqual({ groups: [{ id: 'g-front', name: 'Front', parentId: null, fixtureIds: ['fx-a', 'fx-b'] }] });
    expect(r.results[1]!.value).toEqual({ nodeIds: ['g-front'], fixtureIds: ['fx-a', 'fx-b'] });
  });
});

describe('mutations: execute + undo restores state', () => {
  it('project.setBpm', async () => {
    const r = await applyAndUndo('project.setBpm', { bpm: 128 }, () => expect(readApi.bpm()).toBe(128));
    expect(r.diff).toContainEqual({ entity: 'project', field: 'bpm', from: 120, to: 128 });
    expect(readApi.bpm()).toBe(120);
  });

  it('fixtures.move with z', async () => {
    const r = await applyAndUndo('fixtures.move', { moves: [{ fixtureId: 'fx-c', x: 0.7, z: 0.5 }] }, () => {
      expect(readApi.fixture('fx-c')).toMatchObject({ x: 0.7, y: 0.8, z: 0.5 });
    });
    expect(r.diff).toEqual(expect.arrayContaining([
      { entity: 'fixture:fx-c', field: 'position.x', from: 0.9, to: 0.7 },
      { entity: 'fixture:fx-c', field: 'position.z', from: 0.3, to: 0.5 },
    ]));
  });

  it('fixtures.rotate', async () => {
    await applyAndUndo('fixtures.rotate', { rotations: [{ fixtureId: 'fx-a', rotation: -90 }] }, () => {
      expect(readApi.fixture('fx-a')!.rotation).toBe(270);
    });
  });

  it('nodes.rename (fixture and group)', async () => {
    await applyAndUndo('nodes.rename', { nodeId: 'fx-a', name: 'Left' }, () => expect(readApi.fixture('fx-a')!.name).toBe('Left'));
    const r = await applyAndUndo('nodes.rename', { nodeId: 'g-front', name: 'Downstage' }, () => expect(readApi.groups()[0]!.name).toBe('Downstage'));
    expect(r.diff).toContainEqual({ entity: 'group:g-front', field: 'name', from: 'Front', to: 'Downstage' });
  });

  it('channels.set by type, index and color', async () => {
    const r = await applyAndUndo('channels.set', {
      writes: [
        { fixtureIds: ['fx-a', 'fx-b'], channelType: 'DIMMER', value: 1 },
        { fixtureIds: ['fx-a'], color: '#ff8000' },
      ],
    }, () => {
      const ch = readApi.fixtureDetail('fx-a')!.channels;
      expect(ch.map(c => c.value)).toEqual([255, 128, 0, 255]);
      expect(readApi.fixtureDetail('fx-b')!.channels[3]!.value).toBe(255);
    });
    expect(r.diff).toContainEqual({ entity: 'fixture:fx-a', field: 'channels.3.value', from: 0, to: 255 });
  });

  it('extensionData.set on the project and a fixture', async () => {
    await applyAndUndo('extensionData.set', { owner: 'project', extensionId: 'notes', key: 'text', value: 'hi' }, () => {
      expect(readApi.projectExtensionData()).toEqual({ notes: { text: 'hi' } });
    });
    await applyAndUndo('extensionData.set', { owner: 'fixture', ownerId: 'fx-b', extensionId: 'notes', key: 'k', value: { a: 1 } }, () => {
      expect(readApi.fixtureDetail('fx-b')!.extensionData).toEqual({ notes: { k: { a: 1 } } });
    });
  });

  it('a mixed batch is one undo step', async () => {
    const before = stateFingerprint();
    const r = await applyOperations({
      label: 'Mixed',
      ops: [
        { op: 'project.setBpm', input: { bpm: 90 } },
        { op: 'fixtures.move', input: { moves: [{ fixtureId: 'fx-a', x: 0.2 }] } },
        { op: 'nodes.rename', input: { nodeId: 'fx-b', name: 'Center' } },
      ],
    }, { registry: registry(), actor: 'agent:test' });
    expect(r.committed).toBe(true);
    expect(useHistory().lastDescription.value).toBe('AI: Mixed');
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('errors roll back (unknown fixture, missing value)', async () => {
    const before = stateFingerprint();
    const r = await applyOperations({
      label: 'Bad',
      ops: [
        { op: 'project.setBpm', input: { bpm: 100 } },
        { op: 'channels.set', input: { writes: [{ fixtureIds: ['fx-a'], channelType: 'DIMMER' }] } },
      ],
    }, { registry: registry() });
    expect(r.committed).toBe(false);
    expect(r.findings[0]).toMatchObject({ level: 'error', opIndex: 1 });
    expect(stateFingerprint()).toBe(before);
  });
});
