/**
 * Batch command (plan M4.4): order, atomicity, serializability, lazy replay
 * of children and requirement bookkeeping of batches.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../composables/use-history';
import { BATCH_COMMAND_TYPE, BatchCommand, SerializableBatchCommand, createBatchCommand, flattenCommandTypes } from './batch-command';
import { commandFromPayload, registerCommand, type ReplayContext, type SerializableCommand } from './serializable-command';
import { requirementsOfCommand, requirementsToOpen } from '~/utils/extensions/requires';
import { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { serializeNode } from '~/utils/engine/serialize';
// Registers the 'AddFixtures' replay factory.
import './add-fixture-command';

/** Appends its label to a shared log (serializable). */
class LogCommand implements SerializableCommand {
  readonly commandType = 'TestLog';
  description = 'log';
  constructor(private readonly log: string[], private readonly label: string, private readonly fail = false) {}
  execute() {
    if (this.fail) throw new Error(`fail ${this.label}`);
    this.log.push(`+${this.label}`);
  }
  undo() { this.log.push(`-${this.label}`); }
  inverse(): Command { return new LogCommand(this.log, `inv-${this.label}`); }
  toPayload() { return { label: this.label }; }
}

describe('BatchCommand', () => {
  it('executes in order and undoes in reverse', () => {
    const log: string[] = [];
    const batch = createBatchCommand([new LogCommand(log, 'a'), new LogCommand(log, 'b')], 'Both');
    batch.execute();
    batch.undo();
    expect(log).toEqual(['+a', '+b', '-b', '-a']);
    expect(batch.description).toBe('Both');
  });

  it('rolls back executed children when one fails (all or nothing)', () => {
    const log: string[] = [];
    const batch = createBatchCommand([new LogCommand(log, 'a'), new LogCommand(log, 'b'), new LogCommand(log, 'c', true)]);
    expect(() => batch.execute()).toThrow('fail c');
    expect(log).toEqual(['+a', '+b', '-b', '-a']);
  });

  it('is serializable only when every child is', () => {
    const log: string[] = [];
    const serializable = createBatchCommand([new LogCommand(log, 'a')], 'S');
    expect(serializable).toBeInstanceOf(SerializableBatchCommand);
    expect((serializable as SerializableBatchCommand).toPayload()).toEqual({
      description: 'S',
      commands: [{ commandType: 'TestLog', payload: { label: 'a' } }],
    });
    const local = createBatchCommand([new LogCommand(log, 'a'), { description: 'plain', execute() {}, undo() {} }]);
    expect(local).not.toBeInstanceOf(SerializableBatchCommand);
    expect('commandType' in local).toBe(false);
  });

  it('builds an inverse batch when every child has an inverse', () => {
    const log: string[] = [];
    const inv = new BatchCommand([new LogCommand(log, 'a'), new LogCommand(log, 'b')], 'X').inverse()!;
    inv.execute();
    expect(log).toEqual(['+inv-b', '+inv-a']);
    expect(new BatchCommand([{ description: 'plain', execute() {}, undo() {} }], 'Y').inverse()).toBeNull();
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
      description: 'Add + rename',
      commands: [
        { commandType: 'AddFixtures', payload: { nodes: [JSON.parse(JSON.stringify(serializeNode(added)))] } },
        { commandType: 'TestRename', payload: { id: 'new-1', name: 'Renamed' } },
      ],
    };
    const replayed = commandFromPayload(BATCH_COMMAND_TYPE, payload, ctx)!;
    replayed.execute();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe('Renamed');
    replayed.undo();
    expect(nodes).toHaveLength(0);
    expect((replayed as SerializableCommand).toPayload()).toEqual(payload);
  });

  it('expands batches for requirement bookkeeping', () => {
    const payload = { description: 'x', commands: [
      { commandType: 'SetExtensionData', payload: {} },
      { commandType: BATCH_COMMAND_TYPE, payload: { description: 'y', commands: [{ commandType: 'notes/set', payload: {} }] } },
    ] };
    expect(flattenCommandTypes(BATCH_COMMAND_TYPE, payload)).toEqual(['Batch', 'SetExtensionData', 'Batch', 'notes/set']);
    expect(flattenCommandTypes('MoveFixture', {})).toEqual(['MoveFixture']);
    const src = { extensionVersion: (id: string) => (id === 'notes' ? '1.0.0' : undefined), kindOwner: () => undefined };
    expect(requirementsOfCommand(BATCH_COMMAND_TYPE, payload, src, () => undefined)).toEqual(['notes']);
    expect(requirementsToOpen([], flattenCommandTypes(BATCH_COMMAND_TYPE, payload))).toEqual([{ id: 'notes', version: '*' }]);
  });
});
