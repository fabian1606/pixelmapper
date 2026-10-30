/**
 * Scene operations: `nodes.rename`, `groups.list`, `selection.get`,
 * `extensionData.set` (ADR 0002 §4.2, B3).
 */
import { z } from 'zod';
import type { Json } from '@pixelmapper/extension-api';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { readExtensionData } from '~/components/engine/commands/set-extension-data-command';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import { FixtureIdSchema } from './shared';

/** Resolves a scene node id (fixture or group), tolerating string/number mismatch. */
function resolveNodeId(read: CoreReadApi, id: string | number): string | number | null {
  const match = (x: string | number) => String(x) === String(id);
  return read.fixtures().find(f => match(f.id))?.id ?? read.groups().find(g => match(g.id))?.id ?? null;
}

/** Current name of a scene node. */
function nodeName(read: CoreReadApi, id: string | number): string | undefined {
  return read.fixtures().find(f => f.id === id)?.name ?? read.groups().find(g => g.id === id)?.name;
}

// ── Nodes ───────────────────────────────────────

/** `nodes.rename`. */
export const nodesRename = defineCoreOperation({
  id: 'nodes.rename',
  kind: 'mutation',
  description: 'Rename a scene node: a fixture or a group (ids from project.digest / groups.list).',
  input: z.object({ nodeId: FixtureIdSchema, name: z.string().min(1).max(200) }),
  output: z.object({ nodeId: FixtureIdSchema, previous: z.string() }),
  produces: ['RenameNode'],
  examples: [{ input: { nodeId: 'fx-1', name: 'Front left' } }],
  run(ctx, input) {
    const id = resolveNodeId(ctx.read, input.nodeId);
    if (id === null) throw new Error(`scene node "${String(input.nodeId)}" not found`);
    const previous = nodeName(ctx.read, id) ?? '';
    return { kind: 'mutation', commands: [createCoreCommandFactory().rename({ nodeId: id, name: input.name })], value: { nodeId: id, previous } };
  },
  verify(ctx, input, value) {
    return nodeName(ctx.read, value.nodeId) === input.name ? [] : [{ level: 'error', code: 'rename-not-applied', message: `node ${String(value.nodeId)} was not renamed` }];
  },
});

// ── Groups / selection ──────────────────────────

/** `groups.list`. */
export const groupsList = defineCoreOperation({
  id: 'groups.list',
  kind: 'query',
  description: 'List fixture groups (scene tree folders): id, name, parentId (nested groups) and all fixture ids inside (deep). Group ids can be used as modifier targets (targets.groupIds).',
  input: z.object({}),
  output: z.object({
    groups: z.array(z.object({ id: FixtureIdSchema, name: z.string(), parentId: FixtureIdSchema.nullable(), fixtureIds: z.array(FixtureIdSchema) })),
  }),
  examples: [{ input: {} }],
  run: ctx => ({ kind: 'query', value: { groups: ctx.read.groups() } }),
});

/** `selection.get`. */
export const selectionGet = defineCoreOperation({
  id: 'selection.get',
  kind: 'query',
  description: 'The user\'s current selection in the editor: selected node ids (fixtures and groups) and the fixture ids they expand to. Use it when the user says "these fixtures" / "the selected ones".',
  input: z.object({}),
  output: z.object({ nodeIds: z.array(FixtureIdSchema), fixtureIds: z.array(FixtureIdSchema) }),
  examples: [{ input: {} }],
  run: (ctx) => {
    const s = ctx.read.selection();
    return { kind: 'query', value: { nodeIds: [...s.nodeIds], fixtureIds: [...s.fixtureIds] } };
  },
});

// ── Extension data ──────────────────────────────

/** `extensionData.set`. */
export const extensionDataSet = defineCoreOperation({
  id: 'extensionData.set',
  kind: 'mutation',
  description: [
    'Write namespaced extension data (JSON) on the project, a fixture or a live widget: data[extensionId][key] = value. `value: null` deletes the key.',
    'owner "project" needs no ownerId; "fixture" and "liveWidget" need the owner\'s id.',
  ].join('\n'),
  input: z.object({
    owner: z.enum(['project', 'fixture', 'liveWidget']),
    ownerId: FixtureIdSchema.optional(),
    extensionId: z.string().min(1).describe('Namespace (extension id) of the data.'),
    key: z.string().min(1),
    value: z.unknown().describe('JSON value; null deletes the key.'),
  }),
  output: z.object({ previous: z.unknown() }),
  produces: ['SetExtensionData'],
  examples: [{ input: { owner: 'project', extensionId: 'notes', key: 'text', value: 'Show starts 20:00' } }],
  run(_ctx, input) {
    const previous = readExtensionData(input.owner, input.ownerId, input.extensionId, input.key);
    const value = input.value === null ? undefined : input.value as Json | undefined;
    const cmd = createCoreCommandFactory().setExtensionData({
      owner: input.owner, ownerId: input.ownerId, extensionId: input.extensionId, key: input.key, value,
    });
    return { kind: 'mutation', commands: [cmd], value: { previous } };
  },
});

/** All scene operations. */
export const sceneOperations = [nodesRename, groupsList, selectionGet, extensionDataSet];
