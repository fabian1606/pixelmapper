import type { SerializedNode } from '~/utils/engine/serialize';
import type { EntityId, MergeConflict } from '../types';
import { registerRebaseAdapter, passThroughAdapter, type RebaseAdapter } from './registry';
import { checkOverwrite, findNode, ok, removeConflict, skip } from './helpers';

/**
 * Rebase adapters for the scene tree (`ProjectSnapshot.sceneNodes`):
 * structural commands that reference fixtures/groups by id.
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

interface DeleteNodesPayload { nodeIds: EntityId[] }
interface GroupNodesPayload { nodeIds: EntityId[]; groupId: EntityId; groupName: string }
interface UngroupNodesPayload { groupId: EntityId }
interface RenameNodePayload { nodeId: EntityId; oldName: string; newName: string }

// ── Adapters ─────────────────────────────────────────────────────────────────

/**
 * `DeleteNodes`: drop ids that no longer exist; with `previous`, keep nodes
 * a collaborator modified meanwhile (`remove-modify`). Skip if nothing is left.
 */
export const deleteNodesAdapter: RebaseAdapter = (payload: DeleteNodesPayload, { current, previous }) => {
  const conflicts: MergeConflict[] = [];
  const nodeIds = (payload.nodeIds ?? []).filter((id) => {
    const node = findNode(current.sceneNodes, id);
    if (!node) return false;
    const before = previous ? findNode(previous.sceneNodes, id) : undefined;
    const conflict = removeConflict(before, node, id, [id]);
    if (conflict) conflicts.push(conflict);
    return !conflict;
  });
  if (nodeIds.length === 0) return skip(payload, 'nodes to delete no longer exist or were modified remotely', conflicts);
  return ok({ ...payload, nodeIds }, conflicts);
};

/**
 * `GroupNodes`: group only nodes that still exist (the new group is placed
 * where the first remaining node is). Skip if none is left.
 */
export const groupNodesAdapter: RebaseAdapter = (payload: GroupNodesPayload, { current }) => {
  const nodeIds = (payload.nodeIds ?? []).filter(id => findNode(current.sceneNodes, id));
  if (nodeIds.length === 0) return skip(payload, 'nodes to group no longer exist');
  return ok({ ...payload, nodeIds });
};

/** `UngroupNodes`: skip if the group no longer exists. */
export const ungroupNodesAdapter: RebaseAdapter = (payload: UngroupNodesPayload, { current }) => {
  const node = findNode(current.sceneNodes, payload.groupId);
  if (node?._type !== 'group') return skip(payload, `group ${payload.groupId} no longer exists`);
  return ok(payload);
};

/**
 * `RenameNode`: skip if the node is gone; a concurrent remote rename to a
 * different name is a conflict (local wins). `oldName` becomes the current name.
 */
export const renameNodeAdapter: RebaseAdapter = (payload: RenameNodePayload, { current }) => {
  const node: SerializedNode | undefined = findNode(current.sceneNodes, payload.nodeId);
  if (!node) return skip(payload, `node ${payload.nodeId} no longer exists`);
  const conflicts: MergeConflict[] = [];
  checkOverwrite(payload.oldName, payload.newName, node.name, payload.nodeId, [payload.nodeId, 'name'], conflicts);
  return ok({ ...payload, oldName: node.name }, conflicts);
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all scene-tree adapters. */
export function registerSceneAdapters(): void {
  // Adds new subtrees with fresh ids at the root → replay as recorded.
  registerRebaseAdapter('AddFixtures', passThroughAdapter);
  registerRebaseAdapter('DeleteNodes', deleteNodesAdapter);
  registerRebaseAdapter('GroupNodes', groupNodesAdapter);
  registerRebaseAdapter('UngroupNodes', ungroupNodesAdapter);
  registerRebaseAdapter('RenameNode', renameNodeAdapter);
}
