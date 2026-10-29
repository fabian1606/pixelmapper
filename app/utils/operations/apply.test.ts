/**
 * Transaction runner: dry run, rollback, one undo step, diff, expectations.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useHistory } from '~/components/engine/composables/use-history';
import { CompositeCommand } from '~/components/engine/commands/composite-command';
import { eventLog } from '~/utils/observability/event-log';
import { applyOperations } from './apply';
import { defineCoreOperation } from './define';
import { fixturesMove, fixturesRotate, fixturesFind } from './core/fixtures';
import { readApi } from './read-api';
import { createOperationRegistry } from './registry';
import { registryWith, resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from './test-utils';

/** Mutation whose verify always fails. */
const failingVerify = defineCoreOperation({
  id: 'test.failVerify',
  kind: 'mutation',
  description: 'Moves fx-a, then fails verification.',
  input: z.object({}),
  output: z.object({}),
  run: async (ctx) => (await ctx.ops.call('fixtures.move', { moves: [{ fixtureId: 'fx-a', x: 0.9 }] })) as never,
  verify: () => [{ level: 'error', code: 'nope', message: 'always fails' }],
});

/** Action counting its runs. */
let actionRuns = 0;
const countingAction = defineCoreOperation({
  id: 'test.action',
  kind: 'action',
  description: 'Side effect outside history.',
  input: z.object({}),
  output: z.object({ runs: z.number() }),
  run: () => ({ kind: 'action', value: { runs: ++actionRuns } }),
});

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  seedScene([{ id: 'fx-a', x: 0.1, y: 0.2 }, { id: 'fx-b', x: 0.8, y: 0.2 }]);
});

const registry = () => registryWith(fixturesMove, fixturesRotate, fixturesFind, failingVerify, countingAction);

describe('applyOperations', () => {
  it('commits a batch as one undo step with a semantic diff', async () => {
    const history = useHistory();
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Arrange',
      ops: [
        { op: 'fixtures.move', input: { moves: [{ fixtureId: 'fx-a', x: 0.3 }] } },
        { op: 'fixtures.rotate', input: { rotations: [{ fixtureId: 'fx-b', rotation: 90 }] } },
      ],
    }, { registry: registry(), actor: 'agent:test' });

    expect(result.committed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.diff).toEqual(expect.arrayContaining([
      { entity: 'fixture:fx-a', field: 'position.x', from: 0.1, to: 0.3 },
      { entity: 'fixture:fx-b', field: 'rotation', from: 0, to: 90 },
    ]));
    expect(result.affected.map(a => a.entity).sort()).toEqual(['fixture:fx-a', 'fixture:fx-b']);
    expect(history.lastDescription.value).toBe('AI: Arrange');
    expect(eventLog.list({ undoGroupId: result.undoGroupId })[0]).toMatchObject({ code: 'Composite', actor: 'agent:test' });

    history.undo();
    expect(stateFingerprint()).toBe(before);
    expect(history.canUndo.value).toBe(false);
    history.redo();
    expect(readApi.fixture('fx-a')!.x).toBe(0.3);
  });

  it('later ops see the effect of earlier ops', async () => {
    const result = await applyOperations({
      label: 'Move then find',
      ops: [
        { op: 'fixtures.move', input: { moves: [{ fixtureId: 'fx-b', x: 0.05 }] } },
        { op: 'fixtures.find', input: { bbox: { minX: 0, minY: 0, maxX: 0.2, maxY: 1 } } },
      ],
    }, { registry: registry() });
    const found = result.results[1]!.value as { fixtures: { id: string }[] };
    expect(found.fixtures.map(f => f.id).sort()).toEqual(['fx-a', 'fx-b']);
  });

  it('dry run leaves the state and history untouched', async () => {
    const history = useHistory();
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Try',
      dryRun: true,
      ops: [{ op: 'fixtures.move', input: { moves: [{ fixtureId: 'fx-a', x: 0.5 }] } }, { op: 'test.action', input: {} }],
      expect: [{ path: 'state.fixtures.0.x', eq: 0.5 }],
    }, { registry: registry() });
    expect(result.committed).toBe(false);
    expect(result.diff).toContainEqual({ entity: 'fixture:fx-a', field: 'position.x', from: 0.1, to: 0.5 });
    expect(result.expectations?.[0]?.pass).toBe(true);
    expect(result.results[1]).toEqual({ op: 'test.action', kind: 'action', skipped: true });
    expect(stateFingerprint()).toBe(before);
    expect(history.canUndo.value).toBe(false);
  });

  it('rolls back every op when verify reports an error', async () => {
    const before = stateFingerprint();
    const result = await applyOperations({
      label: 'Fail',
      ops: [
        { op: 'fixtures.rotate', input: { rotations: [{ fixtureId: 'fx-b', rotation: 45 }] } },
        { op: 'test.failVerify', input: {} },
      ],
    }, { registry: registry() });
    expect(result.committed).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ level: 'error', code: 'nope', opIndex: 1 }));
    expect(stateFingerprint()).toBe(before);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('reports invalid input and unknown operations as error findings', async () => {
    const bad = await applyOperations({ label: 'x', ops: [{ op: 'fixtures.move', input: { moves: [] } }] }, { registry: registry() });
    expect(bad.findings[0]).toMatchObject({ code: 'invalid-input', opIndex: 0 });
    const unknown = await applyOperations({ label: 'x', ops: [{ op: 'fixtures.mvoe', input: {} }] }, { registry: registry() });
    expect(unknown.findings[0]).toMatchObject({ code: 'unknown-operation' });
    const missing = await applyOperations({ label: 'x', ops: [{ op: 'fixtures.move', input: { moves: [{ fixtureId: 'nope', x: 0 }] } }] }, { registry: registry() });
    expect(missing.findings[0]).toMatchObject({ code: 'operation-failed' });
  });

  it('runs actions outside history', async () => {
    actionRuns = 0;
    const result = await applyOperations({ label: 'act', ops: [{ op: 'test.action', input: {} }] }, { registry: registry() });
    expect(result.results[0]!.value).toEqual({ runs: 1 });
    expect(result.committed).toBe(false);
    expect(useHistory().canUndo.value).toBe(false);
  });

  it('records a CompositeCommand through the record hook', async () => {
    const recorded: unknown[] = [];
    await applyOperations(
      { label: 'Hook', ops: [{ op: 'fixtures.move', input: { moves: [{ fixtureId: 'fx-a', y: 0.9 }] } }] },
      { registry: registry(), record: cmd => recorded.push(cmd) },
    );
    expect(recorded[0]).toBeInstanceOf(CompositeCommand);
  });
});

describe('operation registry', () => {
  it('enforces unique, namespaced ids and describes with JSON schemas', () => {
    const reg = createOperationRegistry();
    reg.register(fixturesMove);
    expect(() => reg.register(fixturesMove)).toThrow(/duplicate/);
    expect(() => reg.register({ ...fixturesMove, id: 'Bad Id' })).toThrow(/namespace\.name/);
    expect(() => reg.register({ ...fixturesMove, id: 'other/move' }, { extensionId: 'my-ext' })).toThrow(/my-ext\/<name>/);
    reg.register({ ...fixturesMove, id: 'my-ext/move' }, { extensionId: 'my-ext' });

    expect(reg.list({ namespace: 'my-ext' }).map(s => s.id)).toEqual(['my-ext/move']);
    expect(reg.list({ search: 'normalized' }).length).toBe(2);
    const d = reg.describe('fixtures.move')!;
    expect(d.kind).toBe('mutation');
    expect(d.inputSchema.type).toBe('object');
    expect(d.examples.length).toBeGreaterThan(0);
    expect(reg.describe('nope')).toBeNull();
  });
});
