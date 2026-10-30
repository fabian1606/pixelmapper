/**
 * Agent tools (`@pixelmapper/agent-kit` `createTools`) against the real app
 * host: schema snapshot, inspect, describe (operations + guides), apply
 * with actor attribution and undo, observe fallback.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTools, findTool, toolDescriptor, type AgentHost, type ToolOutput } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { eventLog } from '~/utils/observability/event-log';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';
import { readApi } from '~/utils/operations/read-api';
import { resetOperationState, seedScene, stateFingerprint, stubOperationGlobals } from '~/utils/operations/test-utils';
import { createAppAgentHost, OBSERVE_UNAVAILABLE } from './host';

const tools = createTools();
const ACTOR = 'agent:mcp:claude-code' as const;
let host: AgentHost;

/** Runs a tool by name. */
function run(name: string, input: unknown): Promise<ToolOutput> {
  return findTool(tools, name)!.run(host, input, { actor: ACTOR });
}

/** Text of the first content item. */
function textOf(out: ToolOutput): string {
  const first = out.content[0];
  return first?.type === 'text' ? first.text : '';
}

/** JSON content item value. */
function jsonOf<T = unknown>(out: ToolOutput): T {
  const item = out.content.find(c => c.type === 'json');
  return (item && item.type === 'json' ? item.json : undefined) as T;
}

beforeAll(stubOperationGlobals);
beforeEach(() => {
  resetOperationState();
  eventLog.clear();
  seedScene([{ id: 'fx-a', x: 0.1 }, { id: 'fx-b', x: 0.5 }, { id: 'fx-c', x: 0.9 }], [{ id: 'g-left', name: 'Left', fixtureIds: ['fx-a', 'fx-b'] }]);
  host = createAppAgentHost({ registry: registerCoreOperations(createOperationRegistry()), observe: async () => null });
});

describe('tool definitions', () => {
  it('match the schema snapshot', () => {
    expect(tools.map(toolDescriptor)).toMatchSnapshot();
  });

  it('have MCP-valid names and object input schemas', () => {
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.inputSchema.type).toBe('object');
    }
  });
});

describe('inspect', () => {
  it('returns the project digest with a text header', async () => {
    const out = await run('inspect', { selector: 'project' });
    expect(out.isError).toBeUndefined();
    expect(textOf(out)).toContain('3 fixtures');
    expect(jsonOf<{ fixtureCount: number }>(out).fixtureCount).toBe(3);
  });

  it('runs query operations and resolves entity ids', async () => {
    const found = await run('inspect', { selector: { op: 'fixtures.find', input: { groupId: 'g-left' } } });
    expect(JSON.stringify(jsonOf(found) ?? textOf(found))).toContain('fx-a');
    const entities = await run('inspect', { selector: ['fixture:fx-b', 'group:g-left'] });
    expect(textOf(entities)).toContain('"name": "Left"');
  });

  it('rejects mutations and invalid input as tool errors', async () => {
    expect((await run('inspect', { selector: { op: 'modifiers.add', input: {} } })).isError).toBe(true);
    expect((await run('inspect', { selector: 42 })).isError).toBe(true);
  });
});

describe('describe', () => {
  it('describes an operation with its JSON schema', async () => {
    const out = await run('describe', { id: 'modifiers.add' });
    expect(jsonOf<{ inputSchema: { type: string } }>(out).inputSchema.type).toBe('object');
  });

  it('serves guide topics and lists them when unknown', async () => {
    const guide = await run('describe', { id: 'guide:plugin-authoring' });
    expect(textOf(guide)).toContain('# Authoring Content Plugins');
    const sdk = await run('describe', { id: 'guide:plugin-sdk' });
    expect(textOf(sdk).length).toBeGreaterThan(100);
    const unknown = await run('describe', { id: 'guide:nope' });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('guide:modifier-design');
  });

  it('suggests similar ids for unknown operations', async () => {
    const out = await run('describe', { id: 'modifiers.ad' });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain('modifiers.add');
  });
});

describe('apply', () => {
  it('adds a modifier as one undo step attributed to the agent; undo restores', async () => {
    const before = stateFingerprint();
    const out = await run('apply', {
      label: 'Chase',
      ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', recipe: 'chase', targets: { groupIds: ['g-left'] } } }],
      expect: [{ path: 'results.0.modifierId', exists: true }],
    });
    expect(out.isError).toBeUndefined();
    expect(textOf(out)).toContain('Committed "Chase"');
    expect(readApi.modifiers()).toHaveLength(1);
    expect(useHistory().lastDescription.value).toBe('AI: Chase');
    expect(eventLog.list({ actor: ACTOR }).length).toBeGreaterThan(0);
    const events = await run('inspect', { selector: 'events', filter: { actor: ACTOR } });
    expect(textOf(events)).toContain('modifiers.add');
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  });

  it('reports a failed batch as a tool error without changing state', async () => {
    const before = stateFingerprint();
    const out = await run('apply', { label: 'Bad', ops: [{ op: 'modifiers.add', input: { plugin: 'does-not-exist' } }] });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain('ERROR');
    expect(stateFingerprint()).toBe(before);
  });
});

describe('envelope ergonomics (WP-J)', () => {
  it('describe shows the input summary and a ready-to-copy apply call', async () => {
    const out = await run('describe', { id: 'fixtures.move' });
    const body = textOf(out);
    expect(body).toContain('Input (? = optional): { moves: { fixtureId: string | number, x?: number, y?: number, z?: number }[] }');
    expect(body).toContain('apply {"label":"Move one fixture to the left-center","ops":[{"op":"fixtures.move","input":{"moves":[');
    expect(jsonOf<{ exampleCall: { tool: string } }>(out).exampleCall.tool).toBe('apply');
  });

  it('describe accepts `selector` / `op` as alias of `id` and names the key otherwise', async () => {
    expect((await run('describe', { selector: 'fixtures.move' })).isError).toBeUndefined();
    expect((await run('describe', { op: 'fixtures.move' })).isError).toBeUndefined();
    const bad = await run('describe', { what: 'fixtures.move' });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('Unknown key(s): what. Expected keys: id (required).');
  });

  it('inspect accepts `id` as alias of `selector` and a top-level { op, input }', async () => {
    expect(textOf(await run('inspect', { id: 'project' }))).toContain('3 fixtures');
    const found = await run('inspect', { op: 'fixtures.find', input: { name: 'fx-a' } });
    expect(textOf(found)).toContain('fx-a');
  });

  it('operations ends with the envelope reminder', async () => {
    const lines = textOf(await run('operations', {})).split('\n');
    expect(lines.at(-1)).toContain('"ops": [ { "op": "<operation id>", "input": {');
    expect(lines.at(-1)).toContain('describe { "id": "<operation id>" }');
  });

  it('folds input keys placed next to `op` (lenient form) and says so', async () => {
    const out = await run('apply', { label: 'Move', ops: [{ op: 'fixtures.move', moves: [{ fixtureId: 'fx-a', x: 0.3 }] }] });
    expect(out.isError).toBeUndefined();
    expect(textOf(out)).toContain('INFO input-folded (op 0)');
    expect(readApi.fixture('fx-a')?.x).toBeCloseTo(0.3);
  });

  it('names the expected input shape when the input is wrong', async () => {
    const out = await run('apply', { label: 'Move', ops: [{ op: 'fixtures.move', input: { fixtures: [{ fixtureId: 'fx-a', x: 0.3 }] } }] });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain('Expected input (? = optional): { moves: { fixtureId: string | number');
    expect(textOf(out)).toContain('Entry shape: { "op": "fixtures.move", "input": { moves:');
  });

  it('rejects extra keys next to `input` with the fix', async () => {
    const out = await run('apply', { label: 'Move', ops: [{ op: 'fixtures.move', input: {}, moves: [] }] });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain('put `moves` inside `input`');
  });
});

describe('observe', () => {
  it('reports a readable error when observability is unavailable', async () => {
    const out = await run('observe', { targets: 'all' });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(OBSERVE_UNAVAILABLE);
  });

  it('forwards to an injected observe implementation', async () => {
    host = createAppAgentHost({
      registry: registerCoreOperations(createOperationRegistry()),
      observe: async () => async () => ({ text: 'all · steady', json: { ok: true }, expectations: [] }),
    });
    const out = await run('observe', { targets: 'all' });
    expect(textOf(out)).toBe('all · steady');
  });
});
