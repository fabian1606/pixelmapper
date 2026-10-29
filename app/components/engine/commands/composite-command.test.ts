// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CompositeCommand } from './composite-command';
import { RenameNodeCommand } from './rename-command';
import { commandFromPayload, type ReplayContext } from './serializable-command';
import { requirementsOfCommand } from '~/utils/extensions/requires';
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
