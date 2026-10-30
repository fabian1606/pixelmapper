import type { MergeConflict } from '../types';
import { rebaseChange, registerRebaseAdapter, type RebaseAdapter } from './registry';

/**
 * Rebase adapter for `Composite` history commands (ADR 0002 §4.3).
 *
 * Each child is rebased with its own adapter against the same state. Children
 * whose adapter skips them (target gone) are dropped; the composite itself is
 * skipped when no child is left. Children of one composite usually touch
 * disjoint entities, so rebasing them against the common state is adequate.
 */

/** Persisted composite payload (see `composite-command.ts`). */
interface CompositePayloadLike {
  children?: { commandType: string; payload: unknown }[];
  [key: string]: unknown;
}

/** Rebases every child; drops skipped children. */
export const compositeAdapter: RebaseAdapter = (payload: CompositePayloadLike, { current, previous }) => {
  const conflicts: MergeConflict[] = [];
  const children: { commandType: string; payload: unknown }[] = [];
  const skipped: string[] = [];
  for (const child of payload.children ?? []) {
    const r = rebaseChange({ type: child.commandType, payload: child.payload, kind: 'command' }, current, previous);
    conflicts.push(...r.conflicts);
    if (r.skipped) skipped.push(`${child.commandType}: ${r.skipped}`);
    else children.push({ commandType: child.commandType, payload: r.payload });
  }
  const next = { ...payload, children };
  if (children.length === 0 && skipped.length > 0) {
    return { payload: next, conflicts, skipped: `all children skipped (${skipped.join('; ')})` };
  }
  return { payload: next, conflicts };
};

/** Register the composite adapter. */
export function registerCompositeAdapters(): void {
  registerRebaseAdapter('Composite', compositeAdapter);
}
