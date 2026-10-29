import type { SerializedFixture, SerializedNode } from '~/utils/engine/serialize';
import type { LivePage, LiveSection, LiveWidget } from '~/utils/live/types';
import type { EntityId, MergeConflict, MergePath } from '../types';
import type { RebaseResult, RebaseState } from './registry';
import { mergeValues } from '../merge-values';
import { deepClone, deepEqual } from '../values';

/**
 * Shared building blocks of the rebase adapters: result constructors,
 * lookups into plain project state and small merge helpers.
 */

// ── Results ──────────────────────────────────────────────────────────────────

/** Successful rebase. */
export function ok(payload: unknown, conflicts: MergeConflict[] = []): RebaseResult {
  return { payload, conflicts };
}

/** Change dropped with a reason. */
export function skip(payload: unknown, reason: string, conflicts: MergeConflict[] = []): RebaseResult {
  return { payload, conflicts, skipped: reason };
}

/**
 * Field-level 3-way merge of a single value with all conflict paths prefixed
 * and attributed to `entityId`. Returns the merged value.
 */
export function mergeField(
  base: unknown,
  local: unknown,
  remote: unknown,
  entityId: EntityId | null,
  path: MergePath,
  sink: MergeConflict[],
): unknown {
  const res = mergeValues(base, local, remote);
  for (const c of res.conflicts) {
    sink.push({ ...c, entityId: c.entityId ?? entityId, path: [...path, ...c.path] });
  }
  return res.value;
}

/**
 * Conflict for an absolute after-value (`before` → `after`) whose target was
 * changed remotely to something else (`current`). Local wins.
 */
export function checkOverwrite(
  before: unknown,
  after: unknown,
  current: unknown,
  entityId: EntityId | null,
  path: MergePath,
  sink: MergeConflict[],
): void {
  if (deepEqual(current, before) || deepEqual(current, after)) return;
  sink.push({
    entityId,
    path,
    base: deepClone(before),
    local: deepClone(after),
    remote: deepClone(current),
    kind: 'modify-modify',
  });
}

/**
 * Remove-vs-modify guard for deletes (ADR §3.3): if `previous` (what the
 * deleting client saw) differs from `current`, the entity was modified
 * remotely and must be kept. Returns the conflict, or `null` if the delete
 * may proceed. Without `previous` the delete proceeds.
 */
export function removeConflict(
  previous: unknown,
  current: unknown,
  entityId: EntityId,
  path: MergePath,
): MergeConflict | null {
  if (previous === undefined || deepEqual(previous, current)) return null;
  return {
    entityId,
    path,
    base: deepClone(previous),
    local: undefined,
    remote: deepClone(current),
    kind: 'remove-modify',
  };
}

// ── Scene lookups ────────────────────────────────────────────────────────────

/** Depth-first search of a node by id in the scene tree. */
export function findNode(nodes: SerializedNode[] | undefined, id: EntityId): SerializedNode | undefined {
  for (const node of nodes ?? []) {
    if (node.id === id) return node;
    if (node._type === 'group') {
      const hit = findNode(node.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Fixture by id anywhere in the scene tree. */
export function findFixture(state: RebaseState | undefined, id: EntityId): SerializedFixture | undefined {
  const node = findNode(state?.sceneNodes, id);
  return node?._type === 'fixture' ? node : undefined;
}

// ── Live-page lookups ────────────────────────────────────────────────────────

/** Live page by id. */
export function findPage(state: RebaseState | undefined, pageId: string): LivePage | undefined {
  return state?.livePages?.find(p => p.id === pageId);
}

/** Widget by id on a page. */
export function findWidget(state: RebaseState | undefined, pageId: string, widgetId: string): LiveWidget | undefined {
  return findPage(state, pageId)?.widgets.find(w => w.id === widgetId);
}

/** Widget by id on any page (owner `liveWidget` of `SetExtensionData`). */
export function findWidgetAnywhere(state: RebaseState | undefined, widgetId: EntityId): LiveWidget | undefined {
  for (const page of state?.livePages ?? []) {
    const hit = page.widgets.find(w => w.id === widgetId);
    if (hit) return hit;
  }
  return undefined;
}

/** Section by id on a page. */
export function findSection(state: RebaseState | undefined, pageId: string, sectionId: string): LiveSection | undefined {
  return findPage(state, pageId)?.sections?.find(s => s.id === sectionId);
}
