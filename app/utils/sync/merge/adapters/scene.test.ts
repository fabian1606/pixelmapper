// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rebaseChange } from '../index';
import { fixture, group, makeState } from './test-state';

/** Tests of the scene-tree, fixture and channel rebase adapters. */

const scene = () => makeState({ sceneNodes: [fixture(1), group('g', [fixture('f2'), fixture(3)])] });

describe('scene tree', () => {
  it('DeleteNodes drops missing ids and skips when none is left', () => {
    const res = rebaseChange({ type: 'DeleteNodes', payload: { nodeIds: [1, 'gone', 3] } }, scene());
    expect(res.payload).toEqual({ nodeIds: [1, 3] });
    expect(rebaseChange({ type: 'DeleteNodes', payload: { nodeIds: ['gone'] } }, scene()).skipped).toBeTruthy();
  });

  it('DeleteNodes keeps nodes modified remotely (with previous)', () => {
    const previous = scene();
    const current = makeState({ sceneNodes: [fixture(1, { name: 'renamed' }), fixture(3)] });
    const res = rebaseChange({ type: 'DeleteNodes', payload: { nodeIds: [1, 3] } }, current, previous);
    expect(res.payload).toEqual({ nodeIds: [3] });
    expect(res.conflicts).toMatchObject([{ entityId: 1, kind: 'remove-modify' }]);
  });

  it('GroupNodes keeps existing nodes only', () => {
    const res = rebaseChange({ type: 'GroupNodes', payload: { nodeIds: ['x', 'f2'], groupId: 'n', groupName: 'N' } }, scene());
    expect(res.payload).toEqual({ nodeIds: ['f2'], groupId: 'n', groupName: 'N' });
  });

  it('UngroupNodes skips a missing group (or a fixture id)', () => {
    expect(rebaseChange({ type: 'UngroupNodes', payload: { groupId: 'g' } }, scene()).skipped).toBeUndefined();
    expect(rebaseChange({ type: 'UngroupNodes', payload: { groupId: 1 } }, scene()).skipped).toBeTruthy();
  });

  it('RenameNode rebases oldName and reports a concurrent rename', () => {
    const current = makeState({ sceneNodes: [fixture(1, { name: 'remote' })] });
    const res = rebaseChange({ type: 'RenameNode', payload: { nodeId: 1, oldName: 'F1', newName: 'local' } }, current);
    expect(res.payload).toEqual({ nodeId: 1, oldName: 'remote', newName: 'local' });
    expect(res.conflicts).toMatchObject([{ entityId: 1, path: [1, 'name'], kind: 'modify-modify' }]);
  });

  it('AddFixtures passes through', () => {
    const payload = { nodes: [fixture('new')] };
    expect(rebaseChange({ type: 'AddFixtures', payload }, scene()).payload).toEqual(payload);
  });
});

describe('fixture properties', () => {
  it('MoveFixture: local x change merges with remote y change (numeric ids)', () => {
    const current = makeState({ sceneNodes: [fixture(1, { fixturePosition: { x: 0, y: 0.7 } })] });
    const payload = { before: [{ id: 1, x: 0, y: 0 }, { id: 9, x: 0, y: 0 }], after: [{ id: 1, x: 0.5, y: 0 }, { id: 9, x: 1, y: 1 }] };
    const res = rebaseChange({ type: 'MoveFixture', payload }, current);
    expect(res.payload).toEqual({ before: [{ id: 1, x: 0, y: 0.7 }], after: [{ id: 1, x: 0.5, y: 0.7 }] });
    expect(res.conflicts).toEqual([]);
  });

  it('RotateFixture: same field on both sides → local wins', () => {
    const current = makeState({ sceneNodes: [fixture('a', { rotation: 90 })] });
    const payload = { before: [{ id: 'a', rotation: 0 }], after: [{ id: 'a', rotation: 45 }] };
    const res = rebaseChange({ type: 'RotateFixture', payload }, current);
    expect((res.payload as any).after).toEqual([{ id: 'a', rotation: 45 }]);
    expect(res.conflicts).toMatchObject([{ entityId: 'a', path: ['a', 'rotation'], remote: 90 }]);
  });

  it('UpdateDmx skips a deleted fixture and merges the address', () => {
    expect(rebaseChange({ type: 'UpdateDmx', payload: { fixtureId: 7, beforeAddress: 1, afterAddress: 5 } }, scene()).skipped).toBeTruthy();
    const res = rebaseChange({ type: 'UpdateDmx', payload: { fixtureId: 1, beforeAddress: 1, afterAddress: 5 } }, scene());
    expect(res.payload).toEqual({ fixtureId: 1, beforeAddress: 1, afterAddress: 5 });
  });

  it('SetFixtureKindConfig merges config fields', () => {
    const kind = { id: 'k', version: '1', config: { a: 1, b: 9 } };
    const current = makeState({ sceneNodes: [fixture(1, { kind })] });
    const payload = { fixtureId: 1, before: { a: 1, b: 1 }, after: { a: 2, b: 1 }, description: 'x' };
    const res = rebaseChange({ type: 'SetFixtureKindConfig', payload }, current);
    expect(res.payload).toEqual({ fixtureId: 1, before: { a: 1, b: 9 }, after: { a: 2, b: 9 }, description: 'x' });
  });

  it('SetExtensionData merges against the project value and skips missing owners', () => {
    const current = makeState({ extensionData: { ext: { k: { a: 1, b: 2 } } } });
    const payload = { owner: 'project', extensionId: 'ext', key: 'k', before: { a: 1, b: 1 }, after: { a: 5, b: 1 } };
    expect(rebaseChange({ type: 'SetExtensionData', payload }, current).payload)
      .toEqual({ ...payload, before: { a: 1, b: 2 }, after: { a: 5, b: 2 } });
    const missing = { owner: 'fixture', ownerId: 'nope', extensionId: 'e', key: 'k', after: 1 };
    expect(rebaseChange({ type: 'SetExtensionData', payload: missing }, current).skipped).toBeTruthy();
  });

  it('fixture.drag drops missing fixtures', () => {
    const res = rebaseChange({ type: 'fixture.drag', payload: { fixtures: [{ id: 1, x: 1, y: 1 }, { id: 2, x: 0, y: 0 }] } }, scene());
    expect(res.payload).toEqual({ fixtures: [{ id: 1, x: 1, y: 1 }] });
  });
});

describe('channels', () => {
  const ch = (colorValue: string, stepValues: number[]) =>
    ({ type: 'dimmer', addressOffset: 0, role: 'r', colorValue, defaultValue: 0, chaserConfig: { stepValues, speed: 1 } }) as any;

  it('SetChannelValues merges colour and chaser config; drops missing channels', () => {
    const current = makeState({ sceneNodes: [fixture(1, { channels: [ch('#000', [0]), ch('#111', [1])] })] });
    current.sceneNodes[0] && ((current.sceneNodes[0] as any).channels[0].chaserConfig.speed = 4);
    const before = { stepValues: [0], colorValue: '#000', chaserConfig: { stepValues: [0], speed: 1 } };
    const after = { stepValues: [255], colorValue: '#000', chaserConfig: { stepValues: [255], speed: 1 } };
    const payload = { changes: [{ fixtureId: 1, channelIndex: 0, before, after }, { fixtureId: 1, channelIndex: 5, before, after }] };
    const res = rebaseChange({ type: 'SetChannelValues', payload }, current);
    const changes = (res.payload as any).changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].after).toEqual({ stepValues: [255], colorValue: '#000', chaserConfig: { stepValues: [255], speed: 4 } });
    expect(changes[0].before.chaserConfig).toEqual({ stepValues: [0], speed: 4 });
    expect(res.conflicts).toEqual([]);
  });

  it('SetChannelRange reports a concurrent range edit', () => {
    const current = makeState({ sceneNodes: [fixture(1, { channels: [{ ...ch('#000', [0]), rangeMin: 10, rangeMax: 255 }] })] });
    const payload = { changes: [{ fixtureId: 1, channelIndex: 0, before: { rangeMin: 0, rangeMax: 255 }, after: { rangeMin: 20, rangeMax: 255 } }] };
    const res = rebaseChange({ type: 'SetChannelRange', payload }, current);
    expect((res.payload as any).changes[0].after).toEqual({ rangeMin: 20, rangeMax: 255 });
    expect(res.conflicts).toMatchObject([{ entityId: 1, path: [1, 'channels', 0, 'rangeMin'] }]);
  });

  it('channel.update skips when no channel is left', () => {
    const res = rebaseChange({ type: 'channel.update', payload: { channels: [{ fixtureId: 1, channelIndex: 3, stepValues: [], colorValue: '' }] } }, scene());
    expect(res.skipped).toBeTruthy();
  });
});
