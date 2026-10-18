import type { ModifierInstance } from '~/utils/engine/types';
import type { MergeConflict } from '../types';
import { mergeEntityLists } from '../merge-entity-lists';
import { deepClone } from '../values';
import { registerRebaseAdapter, type RebaseAdapter } from './registry';
import { checkOverwrite, ok, skip } from './helpers';

/**
 * Rebase adapters for the modifier list (`ProjectSnapshot.modifiers`).
 *
 * Whole-list changes are turned into a 3-way merge by id so a replay keeps
 * modifiers a collaborator added or edited meanwhile (ADR 0004 §1, §3.3).
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

/** `SetModifiers` history command. */
interface SetModifiersPayload {
  before: ModifierInstance[];
  after: ModifierInstance[];
}

/** `modifier.sync` live-op (after-only whole list). */
interface ModifierSyncPayload {
  modifiers: ModifierInstance[];
}

/** `modifier.update` live-op (field-level patch of one modifier). */
interface ModifierUpdatePayload {
  effectId: string;
  changes: Record<string, unknown>;
  paramChanges?: Record<string, unknown>;
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/**
 * `SetModifiers`: base = before, local = after, remote = current modifiers.
 * Rebased payload: `{ before: current, after: merged }` so undo/replay stay
 * consistent with the state the change is now applied to.
 */
export const setModifiersAdapter: RebaseAdapter = (payload: SetModifiersPayload, { current }) => {
  const remote = current.modifiers ?? [];
  const { value, conflicts } = mergeEntityLists(payload.before ?? [], payload.after ?? [], remote);
  return ok({ ...payload, before: deepClone(remote), after: value }, conflicts);
};

/**
 * `modifier.sync`: the payload has no `before`. With `previous` the list the
 * sender saw is the base (full 3-way merge). Without it the base is empty:
 * remote-only modifiers survive and local values win field-wise, but a
 * modifier deleted locally may reappear if it still exists remotely.
 */
export const modifierSyncAdapter: RebaseAdapter = (payload: ModifierSyncPayload, { current, previous }) => {
  const base = previous?.modifiers ?? [];
  const { value, conflicts } = mergeEntityLists(base, payload.modifiers ?? [], current.modifiers ?? []);
  return ok({ ...payload, modifiers: value }, conflicts);
};

/**
 * `modifier.update`: already field-level → pass through while the modifier
 * exists, skip otherwise. With `previous`, fields changed remotely to a
 * different value are reported (local wins).
 */
export const modifierUpdateAdapter: RebaseAdapter = (payload: ModifierUpdatePayload, { current, previous }) => {
  const id = payload.effectId;
  const target = current.modifiers?.find(m => m.id === id);
  if (!target) return skip(payload, `modifier ${id} no longer exists`);

  const conflicts: MergeConflict[] = [];
  const before = previous?.modifiers?.find(m => m.id === id) as Record<string, any> | undefined;
  if (before) {
    const cur = target as unknown as Record<string, any>;
    for (const [key, value] of Object.entries(payload.changes ?? {})) {
      checkOverwrite(before[key], value, cur[key], id, [id, key], conflicts);
    }
    for (const [key, value] of Object.entries(payload.paramChanges ?? {})) {
      checkOverwrite(before.params?.[key], value, cur.params?.[key], id, [id, 'params', key], conflicts);
    }
  }
  return ok(payload, conflicts);
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all modifier adapters. */
export function registerModifierAdapters(): void {
  registerRebaseAdapter('SetModifiers', setModifiersAdapter);
  registerRebaseAdapter('modifier.sync', modifierSyncAdapter);
  registerRebaseAdapter('modifier.update', modifierUpdateAdapter);
}
