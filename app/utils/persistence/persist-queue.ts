/**
 * Persist queue — the client-side tail of `project_changes` (ADR 0004 D8/D9).
 *
 * History commands (via engine-store `pushChange`) and persistent live-ops
 * (via `enqueueLiveOp`, called from LiveBus `dispatch`) are queued here and
 * flushed to the configured `PersistHook` (the `push-change` edge function).
 *
 * Guarantees:
 * - **Order:** one chronological queue. A coalesced entry (same `dedupKey`)
 *   leaves its old slot and is appended at the end, exactly like its outbox row.
 * - **Durability:** every entry with a `changeId` (history commands and
 *   live-ops) is appended to the `ProjectStore` outbox (`outbox-writer.ts`)
 *   BEFORE it is sent. The push hook (the sync engine) acknowledges rows in
 *   the outbox itself; the optional ack hook is only informational.
 * - **Coalescing:** a newer entry with the same `dedupKey` replaces the pending
 *   older one — in memory and in the outbox — so the old changeId is never pushed.
 * - **Local-only projects:** `setPersistProjectId(id, { outbox: false })`
 *   writes no outbox rows; the working snapshot is their only persistence.
 * - **Serialization:** a single in-flight flush, so `lastSeenSequenceNumber`
 *   (updated inside the hook) is accurate for any caller awaiting a flush.
 * - **Backoff (D9):** failed flushes retry with `backoffDelay(attempt)`. While
 *   `isOnline` is false nothing retries on a timer; `onReconnect` resumes.
 */
import { newUuid } from '~/utils/ids';
import { dropUnwrittenOutboxRow, flushOutboxWrites, queueOutboxRow } from '~/utils/persistence/outbox-writer';
import {
  backoffDelay,
  isNetworkError,
  isOnline,
  onReconnect,
  reportNetworkFailure,
} from '~/utils/sync/connectivity';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersistEntry {
  type: string;
  payload: any;
  /** Client-generated idempotency key (UUID). History commands and live-ops
   *  always carry one so the outbox ack can target them precisely. */
  changeId?: string;
  dedupKey?: string;
  /** Origin. Missing → 'command' (history layer). */
  kind?: 'command' | 'live-op';
  resolve?: (seq: number | undefined) => void;
  reject?: (err: unknown) => void;
}

export type PersistHook = (
  entries: Array<{ type: string; payload: any; changeId?: string }>,
) => Promise<Array<number | undefined>>;

/** Called after a successful flush with all `changeId`s the server acknowledged. */
export type PersistAckHook = (changeIds: string[]) => void;

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Settle window before a flush. The outbox makes correctness independent of
 * this window; it only batches same-frame writes into one request.
 */
export const PERSIST_SETTLE_MS = 50;

// ── State ────────────────────────────────────────────────────────────────────

/** Pending entries in chronological order. */
const queue: PersistEntry[] = [];
/** Index of the pending entry per dedupKey (always also present in `queue`). */
const byKey = new Map<string, PersistEntry>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** True while `flushTimer` is a backoff retry (must not be shortened by new enqueues). */
let retryScheduled = false;
/** Consecutive failed flushes — input for `backoffDelay`. */
let retryAttempt = 0;
let inFlightFlush: Promise<void> | null = null;
let persistHook: PersistHook | null = null;
let persistAckHook: PersistAckHook | null = null;

/** Project outbox rows belong to; null → no outbox rows are written. */
let outboxProjectId: string | null = null;
/**
 * Project whose state is applied (safety gate). Null before the first load,
 * while a project loads and after its session closed: entries are dropped
 * then, so nothing that is not the project's state is ever persisted for it.
 */
let activeProjectId: string | null = null;

// ── Configuration ────────────────────────────────────────────────────────────

/** Wire the network push (null = not ready; entries stay queued). */
export function setPersistHook(hook: PersistHook | null): void {
  persistHook = hook;
  if (hook && queue.length > 0) scheduleFlush();
}

/** Wire the (informational) acknowledgement callback. */
export function setPersistAckHook(hook: PersistAckHook | null): void {
  persistAckHook = hook;
}

/**
 * Set the project outbox rows are scoped to. Captured per entry at enqueue
 * time, so switching projects never re-labels pending rows. With
 * `{ outbox: false }` (local-only projects) no outbox rows are written.
 * Call it only once the project's state is applied; `null` closes the gate
 * (load in progress, session closed) and new entries are dropped.
 */
export function setPersistProjectId(projectId: string | null, options: { outbox?: boolean } = {}): void {
  activeProjectId = projectId;
  outboxProjectId = options.outbox === false ? null : projectId;
}

/** Queue the outbox row of an entry (no-op without changeId / outbox project). */
function queueRow(entry: PersistEntry): void {
  if (!outboxProjectId || !entry.changeId) return;
  const kind = entry.kind ?? 'command';
  queueOutboxRow({
    id: entry.changeId,
    projectId: outboxProjectId,
    kind,
    type: entry.type,
    payload: entry.payload,
    dedupKey: entry.dedupKey,
  }, kind === 'command');
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/** Queue an entry for the next flush (coalescing by `dedupKey`). */
export function enqueuePersist(entry: PersistEntry): void {
  // Safety gate: without an applied project the change belongs to none.
  if (!activeProjectId) {
    console.warn(`[persist] "${entry.type}" dropped: no project state is applied`);
    entry.resolve?.(undefined);
    return;
  }
  if (entry.dedupKey) {
    const prev = byKey.get(entry.dedupKey);
    if (prev && prev !== entry) {
      // Superseded: drop its slot, its unwritten outbox row, and resolve its
      // promise with undefined so callers never wait forever.
      const idx = queue.indexOf(prev);
      if (idx >= 0) queue.splice(idx, 1);
      if (prev.changeId) dropUnwrittenOutboxRow(prev.changeId);
      prev.resolve?.(undefined);
    }
    byKey.set(entry.dedupKey, entry);
  }
  // Durable before it is sent (outbox write is queued first, D8).
  queueRow(entry);
  queue.push(entry);
  scheduleFlush();
}

/**
 * Queue a persistent live-op: assigns a `changeId`, schedules its outbox
 * write (coalesced by `dedupKey`) and enqueues it for the server push.
 * Returns the assigned changeId.
 */
export function enqueueLiveOp(type: string, payload: unknown, dedupKey?: string): string {
  const changeId = newUuid();
  enqueuePersist({ type, payload, changeId, dedupKey, kind: 'live-op' });
  return changeId;
}

// ── Outbox writes ────────────────────────────────────────────────────────────

/**
 * Make all queued outbox rows durable now (see `outbox-writer.ts`). Kept
 * under its WP-P0 name because LiveBus and engine-store call it from
 * unload/visibility handlers.
 */
export function flushPersistWal(): Promise<void> {
  return flushOutboxWrites();
}

// ── Flush ────────────────────────────────────────────────────────────────────

/** Arm the settle timer unless offline or a backoff retry is pending. */
function scheduleFlush(): void {
  // Offline: the reconnect listener below resumes flushing.
  if (!isOnline.value) return;
  // A backoff retry is pending: don't shorten it with every new entry.
  if (retryScheduled) return;
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; void flushPersistQueue(); }, PERSIST_SETTLE_MS);
}

/** After a failed flush: retry with backoff, or wait for reconnect when offline. */
function scheduleRetry(): void {
  if (queue.length === 0) return;
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
  retryScheduled = false;
  if (!isOnline.value) return; // onReconnect resumes
  const delay = backoffDelay(retryAttempt++);
  retryScheduled = true;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    retryScheduled = false;
    void flushPersistQueue();
  }, delay);
}

/**
 * Drain pending entries to the hook. Serialized via `inFlightFlush`: a second
 * concurrent caller awaits the in-flight round-trip, then runs its own pass.
 * Safe to call from doSaveSnapshot, beforeunload or Cmd+S. Never throws;
 * failures re-queue the entries and schedule a retry.
 */
export async function flushPersistQueue(): Promise<void> {
  // Loop: another waiter may have started the next pass while we awaited.
  while (inFlightFlush) await inFlightFlush;
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
  retryScheduled = false;
  if (queue.length === 0) return;
  if (!persistHook) return; // not wired yet — setPersistHook() re-arms the timer

  inFlightFlush = runFlush(persistHook);
  try { await inFlightFlush; }
  finally { inFlightFlush = null; }
}

/** One flush pass: take the queue, make its outbox rows durable, push, ack. */
async function runFlush(hook: PersistHook): Promise<void> {
  // Take the batch first: every entry in it had its outbox row queued before
  // this point, so the outbox flush below covers all of them.
  const batch = queue.splice(0);
  byKey.clear();

  // Outbox before network: every row must be durable before it is sent.
  await flushOutboxWrites();

  try {
    const seqs = await hook(batch.map(e => ({ type: e.type, payload: e.payload, changeId: e.changeId })));
    retryAttempt = 0;
    // No `reportNetworkSuccess()` here: the hook may resolve without any
    // request (local-only project, unbound copy, nothing to push). Requests
    // that do reach the backend report it themselves (`invokeRemote`).
    for (let i = 0; i < batch.length; i++) batch[i]!.resolve?.(seqs[i]);
    // Report entries the server returned a sequence number for; the rest stay
    // in the outbox so the sync engine retries them idempotently.
    if (persistAckHook) {
      const acked: string[] = [];
      for (let i = 0; i < batch.length; i++) {
        const e = batch[i]!;
        if (e.changeId && seqs[i] != null) acked.push(e.changeId);
      }
      if (acked.length > 0) persistAckHook(acked);
    }
  }
  catch (err) {
    console.warn('[persist] flush failed:', err);
    if (isNetworkError(err)) reportNetworkFailure();
    requeueFront(batch);
    for (const e of batch) e.reject?.(err);
    scheduleRetry();
  }
}

/**
 * Put a failed batch back in front of newer entries, keeping its order.
 * Coalesced entries are dropped if a newer payload for their key arrived
 * meanwhile (that newer entry's outbox row already replaced theirs).
 */
function requeueFront(batch: PersistEntry[]): void {
  const keep: PersistEntry[] = [];
  for (const e of batch) {
    if (e.dedupKey) {
      if (byKey.has(e.dedupKey)) continue;
      byKey.set(e.dedupKey, e);
    }
    keep.push(e);
  }
  queue.unshift(...keep);
}

// ── Inspection / reset ───────────────────────────────────────────────────────

/** Snapshot of pending entries — used by beforeunload to drain via keepalive fetch. */
export function getPersistQueueSnapshot(): Array<{ type: string; payload: any; changeId?: string }> {
  return queue.map(e => ({ type: e.type, payload: e.payload, changeId: e.changeId }));
}

/**
 * True if history commands (non-live-op entries) are still unsent. A snapshot
 * built now would contain their effect with a sequence number before them, so
 * replaying them later on top of it would apply them twice.
 */
export function hasPendingCommandPersist(): boolean {
  return queue.some(e => e.kind !== 'live-op');
}

/**
 * Drop all pending entries without resolving callers' data. Used on project
 * switch to discard ops queued against the previous project. Their outbox
 * rows (already written or flushed here) stay and are synced on that
 * project's next open. Callers that want them on the server now must
 * `await flushPersistQueue()` first.
 */
export function clearPersistQueue(): void {
  for (const e of queue) e.resolve?.(undefined);
  queue.length = 0;
  byKey.clear();
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
  retryScheduled = false;
  retryAttempt = 0;
  // Keep durability: write any still-queued rows of the old project.
  void flushOutboxWrites();
}

// ── Connectivity ─────────────────────────────────────────────────────────────

// Back online: reset the backoff and push whatever accumulated offline.
onReconnect(() => {
  retryAttempt = 0;
  retryScheduled = false;
  if (queue.length > 0) scheduleFlush();
});
