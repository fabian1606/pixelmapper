// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CompositeCommand, createBatchCommand } from './composite-command';
import { RenameNodeCommand } from './rename-command';
import { commandFromPayload, registerCommand, type ReplayContext, type SerializableCommand } from './serializable-command';
import { flattenCommandTypes, requirementsOfCommand, requirementsToOpen } from '~/utils/extensions/requires';
import type { SceneNode } from '~/utils/engine/core/group';
import { serializeNode } from '~/utils/engine/serialize';
// Registers the 'AddFixtures' replay factory.
import './add-fixture-command';
import { rebaseChange } from '~/utils/sync/merge/adapters/registry';
import { registerCompositeAdapters } from '~/utils/sync/merge/adapters/composite';
import { Fixture } from '~/utils/engine/core/fixture';
import type { Command } from '../composables/use-history';

/** Two named fixtures as scene nodes. */
function scene() {
  const a = Fixture.createRGBFixture('a');
  a.name = 'A';
  const b = Fixture.createRGBFixture('b');
  b.name = 'B';
  return { a, b };
}

/** Minimal replay context over the given scene nodes. */
function replayContext(nodes: Fixture[]): ReplayContext {
  return {
    sceneNodes: nodes,
    flatFixtures: nodes,
    modifiers: [],
    savedPresets: [],
    setSavedPresets: () => {},
    getSelectedPresetId: () => null,
    setSelectedPresetId: () => {},
  };
}

describe('CompositeCommand', () => {
  it('executes in order and undo restores the state in reverse', () => {
    const { a, b } = scene();
    const order: string[] = [];
    const spy: Command = { description: 'spy', execute: () => order.push('spy'), undo: () => order.push('spy-undo') };
    const cmd = new CompositeCommand([new RenameNodeCommand(a, 'A2'), spy, new RenameNodeCommand(b, 'B2')], 'AI: rename', 'agent:test');
    cmd.execute();
    expect([a.name, b.name]).toEqual(['A2', 'B2']);
    cmd.undo();
    expect([a.name, b.name]).toEqual(['A', 'B']);
    expect(order).toEqual(['spy', 'spy-undo']);
  });

  it('is atomic: a throwing child rolls back earlier children', () => {
    const { a } = scene();
    const boom: Command = { description: 'boom', execute: () => { throw new Error('boom'); }, undo: vi.fn() };
    const cmd = new CompositeCommand([new RenameNodeCommand(a, 'A2'), boom], 'x');
    expect(() => cmd.execute()).toThrow('boom');
    expect(a.name).toBe('A');
    expect(boom.undo).not.toHaveBeenCalled();
  });

  it('serializes children and replays from the payload', () => {
    const { a, b } = scene();
    const local: Command = { description: 'local only', execute() {}, undo() {} };
    const cmd = new CompositeCommand([new RenameNodeCommand(a, 'A2'), local, new RenameNodeCommand(b, 'B2')], 'AI: rename', 'agent:test');
    const payload = cmd.toPayload();
    expect(payload).toMatchObject({ label: 'AI: rename', actor: 'agent:test', id: cmd.id });
    expect(payload.children.map(c => c.commandType)).toEqual(['RenameNode', 'RenameNode']);

    // Replay on a fresh "client" (other model instances, same ids).
    const other = scene();
    const replayed = commandFromPayload('Composite', JSON.parse(JSON.stringify(payload)), replayContext([other.a, other.b]));
    expect(replayed).toBeInstanceOf(CompositeCommand);
    expect((replayed as CompositeCommand).actor).toBe('agent:test');
    expect((replayed as CompositeCommand).id).toBe(cmd.id);
    replayed!.execute();
    expect([other.a.name, other.b.name]).toEqual(['A2', 'B2']);
    replayed!.undo();
    expect([other.a.name, other.b.name]).toEqual(['A', 'B']);
  });

  it('inverse() groups the children inverses in reverse order', () => {
    const inv = (label: string): Command => ({ description: label, execute() {}, undo() {} });
    const child = (label: string, withInverse: boolean): Command => ({
      description: label, execute() {}, undo() {}, ...(withInverse ? { inverse: () => inv(`inv-${label}`) } : {}),
    });
    const cmd = new CompositeCommand([child('a', true), child('b', false), child('c', true)], 'x');
    const inverse = cmd.inverse() as CompositeCommand;
    expect(inverse.children.map(c => c.description)).toEqual(['inv-c', 'inv-a']);
    expect(new CompositeCommand([child('b', false)], 'y').inverse()).toBeNull();
  });

  it('counts namespaced children as project requirements', () => {
    const src = { extensionVersion: (id: string) => (id === 'notes' ? '1.2.0' : undefined), kindOwner: () => undefined };
    const payload = { children: [{ commandType: 'notes/set', payload: {} }, { commandType: 'RenameNode', payload: {} }] };
    expect(requirementsOfCommand('Composite', payload, src, () => undefined)).toEqual(['notes']);
  });

  it('rebases children with their own adapters', () => {
    registerCompositeAdapters();
    const payload = { id: 'g', label: 'x', actor: 'user', children: [{ commandType: 'unknown/x', payload: { v: 1 } }] };
    const r = rebaseChange({ type: 'Composite', payload }, {} as never);
    expect(r.skipped).toBeUndefined();
    expect(r.payload).toEqual(payload);
  });
});

// ── Batches (extension API `commands.batch`, plan M4.4) ──

describe('createBatchCommand', () => {
  it('is one composite: order, reverse undo, serialized children', () => {
    const { a, b } = scene();
    const batch = createBatchCommand([new RenameNodeCommand(a, 'A2'), new RenameNodeCommand(b, 'B2')], 'Both');
    expect(batch).toBeInstanceOf(CompositeCommand);
    batch.execute();
    expect([a.name, b.name]).toEqual(['A2', 'B2']);
    batch.undo();
    expect([a.name, b.name]).toEqual(['A', 'B']);
    expect(batch.toPayload()).toMatchObject({ label: 'Both', actor: 'user', children: [{ commandType: 'RenameNode' }, { commandType: 'RenameNode' }] });
  });

  it('replays children lazily, so later children see fixtures added by earlier ones', () => {
    // A test command that renames a fixture found in the replay context at construction time.
    registerCommand('TestRename', (payload, ctx) => {
      const fixture = ctx.flatFixtures.find(f => f.id === payload.id);
      return { description: 'rename', execute() { if (fixture) fixture.name = payload.name; }, undo() {} };
    });
    const added = Fixture.createRGBFixture('new-1');
    const nodes: SceneNode[] = [];
    const ctx = { sceneNodes: nodes, flatFixtures: [] } as unknown as ReplayContext;
    const payload = {
      id: 'g1',
      label: 'Add + rename',
      actor: 'user',
      children: [
        { commandType: 'AddFixtures', payload: { nodes: [JSON.parse(JSON.stringify(serializeNode(added)))] } },
        { commandType: 'TestRename', payload: { id: 'new-1', name: 'Renamed' } },
      ],
    };
    const replayed = commandFromPayload('Composite', payload, ctx)!;
    replayed.execute();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe('Renamed');
    replayed.undo();
    expect(nodes).toHaveLength(0);
    expect((replayed as SerializableCommand).toPayload()).toEqual(payload);
  });

  it('expands composites for the open gate', () => {
    const payload = { children: [
      { commandType: 'SetExtensionData', payload: {} },
      { commandType: 'Composite', payload: { children: [{ commandType: 'notes/set', payload: {} }] } },
    ] };
    expect(flattenCommandTypes('Composite', payload)).toEqual(['Composite', 'SetExtensionData', 'Composite', 'notes/set']);
    expect(flattenCommandTypes('MoveFixture', {})).toEqual(['MoveFixture']);
    expect(requirementsToOpen([], flattenCommandTypes('Composite', payload))).toEqual([{ id: 'notes', version: '*' }]);
  });
});
