import type { RemoteChange } from '~/utils/sync/remote-api';
import type { ReplayableChange } from '~/utils/sync/project-state-port';
import { computeRebase, type PendingRow } from '~/utils/sync/sync-rebase';
import { mergePending, plain, type SyncDeps, type SyncState } from '~/utils/sync/sync-context';
import { packSnapshot } from '~/utils/sync/sync-position';
import { pullAll } from '~/utils/sync/sync-transport';

/**
 * One pull → (apply | rebase) step of the sync cycle (ADR 0004 §3.2 steps 1–4).
 * The push (step 4.5) follows in the engine. Callers hold the engine lock.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Outcome of a pull step. */
export type PullOutcome =
  | { ok: true; rebased: boolean; applied: number }
  | { ok: false };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Server row → replayable change. */
function toReplay(c: RemoteChange): ReplayableChange {
  return { type: c.commandType, payload: c.payload, userId: c.userId };
}

/** Replay foreign changes directly onto the live state. */
function applyDirect(deps: SyncDeps, changes: RemoteChange[]): void {
  for (const c of changes) {
    try {
      if (!deps.port.replay(toReplay(c))) console.warn(`[sync] no handler for remote change "${c.commandType}"`);
    }
    catch (err) {
      console.warn(`[sync] remote change "${c.commandType}" failed:`, err);
    }
  }
}

// ── Pull step ────────────────────────────────────────────────────────────────

/**
 * Pull everything after the lower of the base and live floors, then:
 * - own changes (in the outbox) count as acknowledged (§3.2 step 2);
 * - no backlog or no pending changes: apply unseen remote changes directly
 *   to the live state (step 3; the base is checkpointed lazily once nothing
 *   is pending);
 * - backlog with pending changes and unseen remote changes: rebase (step 4).
 */
export async function pullStep(deps: SyncDeps, state: SyncState): Promise<PullOutcome> {
  const from = Math.min(state.live.pullFrom(), state.base?.position.pullFrom() ?? Number.POSITIVE_INFINITY);
  const pulled = await pullAll(deps.client, deps.projectId, from);
  if (!pulled.ok) {
    state.lastError = pulled.error;
    return { ok: false };
  }
  state.lastError = null;
  await deps.outbox.flush();
  const stored = await deps.store.getOutbox(deps.projectId);

  // ── Synchronous section: no await until the state is consistent again ──
  const pending = mergePending(stored, deps.outbox.unconfirmed());
  const pendingIds = new Set(pending.map(p => p.id));
  const { changes, nextAfterSequence } = pulled.data;
  const ownAcked = changes.filter(c => pendingIds.has(c.changeId));
  const ownAckedIds = new Set(ownAcked.map(c => c.changeId));
  // Pulled own rows are confirmed (e.g. an ack lost in a crash): hand their
  // sequence numbers to the persist queue like push acks, and treat their
  // realtime echo as own.
  for (const c of ownAcked) {
    state.ownIds.add(c.changeId);
    state.ackedSeq.set(c.changeId, c.sequenceNumber);
  }
  const stillPending = pending.filter(p => !ownAckedIds.has(p.id));
  const foreignUnseen = changes.filter(c =>
    !pendingIds.has(c.changeId) && !state.ownIds.has(c.changeId) && !state.live.reflects(c.changeId, c.sequenceNumber));

  const base = state.base;
  // The rebase decision is taken against the BASE, not the live position: a
  // foreign row the live state already has (realtime insert while offline
  // edits were pending) is still missing from the base the pending payloads
  // were made on. Deciding by `live` would skip the rebase and push the stale
  // payloads, wiping that row for everyone (and without a D5 snapshot).
  // The rebase rebuilds the live state from the base, so nothing applies twice.
  const foreignSinceBase = base
    ? changes.filter(c => !pendingIds.has(c.changeId) && !state.ownIds.has(c.changeId) && !base.position.reflects(c.changeId, c.sequenceNumber))
    : [];
  if (state.backlog && base && stillPending.length > 0 && foreignSinceBase.length > 0) {
    await rebaseStep(deps, state, { changes, nextAfterSequence, stillPending, ownAckedIds });
    return { ok: true, rebased: true, applied: foreignUnseen.length };
  }

  applyDirect(deps, foreignUnseen);
  for (const c of changes) {
    state.live.add(c.changeId, c.sequenceNumber);
    deps.onSequence?.(c.sequenceNumber);
  }
  state.live.advance(nextAfterSequence);
  if (foreignUnseen.length > 0) deps.onLiveChanged?.();
  // ── End of synchronous section ──

  if (ownAckedIds.size > 0) await deps.store.ackOutbox([...ownAckedIds]);
  if (foreignUnseen.length > 0) await deps.writeWorking();
  return { ok: true, rebased: false, applied: foreignUnseen.length };
}

// ── Rebase step ──────────────────────────────────────────────────────────────

interface RebaseStepInput {
  changes: RemoteChange[];
  nextAfterSequence: number;
  stillPending: PendingRow[];
  ownAckedIds: Set<string>;
}

/**
 * §3.2 step 4: new base = base + remote changes, transform pending changes,
 * replace the live state, rewrite the outbox and remember the D5 safety
 * snapshot (saved before the next push).
 */
async function rebaseStep(deps: SyncDeps, state: SyncState, input: RebaseStepInput): Promise<void> {
  const base = state.base!;
  // Everything the old base does not reflect, own acknowledged changes included
  // (server order is authoritative for the new base).
  const baseApply = input.changes.filter(c => !base.position.reflects(c.changeId, c.sequenceNumber));
  const out = computeRebase({
    port: deps.port,
    base: base.snapshot,
    remote: baseApply.map(toReplay),
    pending: input.stillPending,
  });
  const position = base.position.clone();
  for (const c of baseApply) {
    position.add(c.changeId, c.sequenceNumber);
    deps.onSequence?.(c.sequenceNumber);
  }
  position.advance(input.nextAfterSequence);
  const newBase = plain(out.newBase);
  state.base = { snapshot: newBase, position };
  state.live = position.clone();
  state.safety = { snapshot: newBase, seq: position.highest() };
  // A snapshot saved for an earlier rebase must not be offered as "restore
  // state before sync" for the conflicts of this one.
  state.safetySnapshotId = null;
  state.conflicts = out.conflicts.length > 0 ? { items: out.conflicts, state: plain(out.working) } : null;
  deps.onLiveChanged?.();
  // ── End of synchronous section ──

  // Rows still being written must land before they can be rewritten.
  await deps.outbox.flush();
  const stored = await deps.store.getOutbox(deps.projectId);
  const rebasedById = new Map(out.rebased.map(r => [r.id, r]));
  const updates = stored
    .filter(r => rebasedById.has(r.id))
    .map(r => ({ ...r, payload: plain(rebasedById.get(r.id)!.payload) }));
  if (updates.length > 0) await deps.store.updateOutbox(updates);
  const drop = [...out.skipped.map(r => r.id), ...input.ownAckedIds];
  if (drop.length > 0) await deps.store.ackOutbox(drop);
  for (const r of out.skipped) console.info(`[sync] dropped pending "${r.type}" during rebase`);
  await deps.store.putBaseSnapshot(deps.projectId, packSnapshot(newBase, position), position.cursor);
  await deps.writeWorking();
}
