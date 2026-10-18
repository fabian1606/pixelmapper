import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { Distribution } from '@pixelmapper/extension-api';
import { migrateLegacyChanges, migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution';
import { rebaseChange } from '~/utils/sync/merge';
import type { ProjectStatePort, ReplayableChange } from '~/utils/sync/project-state-port';
import type { SyncConflictItem } from '~/utils/sync/sync-conflicts';

/**
 * Rebase computation (ADR 0004 §3.2 step 4).
 *
 * Runs synchronously on the live state through the `ProjectStatePort`, so no
 * user edit can interleave. On return the live state equals
 * `new base + rebased pending changes`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A pending local change (outbox row or a row not yet written). */
export interface PendingRow {
  id: string;
  type: string;
  kind: 'command' | 'live-op';
  payload: unknown;
  dedupKey?: string;
}

export interface RebaseInput {
  port: ProjectStatePort;
  /** Old base snapshot (server state the pending changes were made on). */
  base: ProjectSnapshot;
  /** Server changes to apply to the old base, in server order. */
  remote: ReplayableChange[];
  /** Pending local changes, in outbox order. */
  pending: PendingRow[];
}

export interface RebaseOutput {
  /** Old base + remote changes (the server state now). */
  newBase: ProjectSnapshot;
  /** Kept pending changes with rebased payloads (outbox order). */
  rebased: PendingRow[];
  /** Pending changes the adapters dropped (target gone, no-op). */
  skipped: PendingRow[];
  /** True conflicts (local won), with the change type. */
  conflicts: SyncConflictItem[];
  /** Live state after the rebase (new base + rebased changes). */
  working: ProjectSnapshot;
}

// ── Payload migration ────────────────────────────────────────────────────────

/**
 * Bring an old (schema v2) pending payload to the current modifier model
 * before rebasing; the merge adapters only know the current shape.
 */
export function migratePendingPayload(type: string, payload: unknown, current: ProjectSnapshot): unknown {
  const migrated = migrateModifiersDeep(payload);
  if (type !== 'modifier.update' || !migrated || typeof migrated !== 'object') return migrated;
  const p = migrated as { effectId?: string; changes?: Record<string, unknown> };
  const target = (current.modifiers ?? []).find(m => (m as { id?: string }).id === p.effectId) as { distribution?: Distribution } | undefined;
  if (!target?.distribution || !p.changes) return migrated;
  return { ...p, changes: migrateLegacyChanges(target.distribution, p.changes) };
}

// ── Rebase ───────────────────────────────────────────────────────────────────

/** Replay a change, logging (not throwing) when it fails. */
function safeReplay(port: ProjectStatePort, change: ReplayableChange): void {
  try {
    if (!port.replay(change)) console.warn(`[sync] no handler for change "${change.type}"`);
  }
  catch (err) {
    console.warn(`[sync] replay of "${change.type}" failed:`, err);
  }
}

/**
 * Compute new base, rebased pending changes and the working state.
 *
 * 1. `previous[i]` = old base + original pending[0..i-1] (what change i was
 *    originally applied to; lets adapters tell remote edits from local ones).
 * 2. new base = old base + remote changes.
 * 3. Each pending change is rebased against new base + already rebased
 *    changes, then replayed. Skipped changes are dropped.
 */
export function computeRebase(input: RebaseInput): RebaseOutput {
  const { port, base, remote, pending } = input;

  // 1. States the pending changes were originally applied to.
  port.apply(base);
  const previous: ProjectSnapshot[] = [];
  for (const row of pending) {
    previous.push(port.capture());
    safeReplay(port, { type: row.type, payload: row.payload });
  }

  // 2. Server state now.
  port.apply(base);
  for (const change of remote) safeReplay(port, change);
  const newBase = port.capture();

  // 3. Transform and replay the pending changes in order.
  const rebased: PendingRow[] = [];
  const skipped: PendingRow[] = [];
  const conflicts: SyncConflictItem[] = [];
  let current = newBase;
  pending.forEach((row, i) => {
    const payload = migratePendingPayload(row.type, row.payload, previous[i]!);
    const result = rebaseChange({ type: row.type, payload, kind: row.kind }, current, previous[i]);
    for (const conflict of result.conflicts) conflicts.push({ changeType: row.type, conflict });
    if (result.skipped) {
      skipped.push(row);
      return;
    }
    const next = { ...row, payload: result.payload };
    safeReplay(port, { type: next.type, payload: next.payload });
    rebased.push(next);
    current = port.capture();
  });

  return { newBase, rebased, skipped, conflicts, working: current };
}

/** Apply a list of changes to `snapshot` through the port; returns the result. */
export function applyChanges(port: ProjectStatePort, snapshot: ProjectSnapshot, changes: ReplayableChange[]): ProjectSnapshot {
  port.apply(snapshot);
  for (const change of changes) safeReplay(port, change);
  return port.capture();
}
