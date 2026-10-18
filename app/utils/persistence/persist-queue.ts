/**
 * Persist queue — the client-side tail of `project_changes` (ADR 0004 D8/D9).
 *
 * History commands (via engine-store `pushChange`) and persistent live-ops
 * (via `enqueueLiveOp`, called from LiveBus `dispatch`) are queued here and
 * flushed to the configured `PersistHook` (the `push-change` edge function).
 *
 * Guarantees:
 * - **Order:** one chronological queue. A coalesced entry (same `dedupKey`)
 *   leaves its old slot and is appended at the end, exactly like its WAL row.
 * - **Durability:** every live-op gets a client `changeId` and is written to
 *   the WAL (`wal.ts`) BEFORE it is sent. History commands are written to the
 *   WAL by `use-history`. Acknowledged ids are removed via the ack hook.
 * - **Coalescing:** a newer entry with the same `dedupKey` replaces the pending
 *   older one — in memory and in the WAL — so the old changeId is never pushed.
 * - **Serialization:** a single in-flight flush, so `lastSeenSequenceNumber`
 *   (updated inside the hook) is accurate for any caller awaiting a flush.
 * - **Backoff (D9):** failed flushes retry with `backoffDelay(attempt)`. While
 *   `isOnline` is false nothing retries on a timer; `onReconnect` resumes.
 */
import { newUuid } from '~/utils/ids';
import { walAppendBatch, walNextEnqueuedAt, type WalEntry } from '~/utils/persistence/wal';
import {
  backoffDelay,
  isNetworkError,
  isOnline,
  onReconnect,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '~/utils/sync/connectivity';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersistEntry {
  type: string;
  payload: any;
  /** Client-generated idempotency key (UUID). History commands and live-ops
   *  always carry one so the WAL ACK can target them precisely. */
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
 * Settle window before a flush. The WAL makes correctness independent of
 * this window; it only batches same-frame writes into one request.
 */
export const PERSIST_SETTLE_MS = 50;

/** Window in which live-op WAL writes are coalesced (60 Hz drags → ~20 Hz IDB writes). */
export const WAL_SETTLE_MS = 50;

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

/** Project the live-op WAL rows belong to; null → live-ops are not WAL-logged. */
let walProjectId: string | null = null;
/** Live-op WAL rows not yet written (coalesced by dedupKey). */
const walPending: WalEntry[] = [];
let walTimer: ReturnType<typeof setTimeout> | null = null;
/** Serializes WAL writes so their transactions are created in order. */
let walChain: Promise<void> = Promise.resolve();

// ── Configuration ────────────────────────────────────────────────────────────

/** Wire the network push (null = not ready; entries stay queued). */
export function setPersistHook(hook: PersistHook | null): void {
  persistHook = hook;
  if (hook && queue.length > 0) scheduleFlush();
}

/** Wire the WAL acknowledgement callback. */
export function setPersistAckHook(hook: PersistAckHook | null): void {
  persistAckHook = hook;
}

/**
 * Set the project live-op WAL rows are scoped to. Captured per entry at
 * enqueue time, so switching projects never re-labels pending rows.
 */
export function setPersistProjectId(projectId: string | null): void {
  walProjectId = projectId;
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/** Queue an entry for the next flush (coalescing by `dedupKey`). */
export function enqueuePersist(entry: PersistEntry): void {
  if (entry.dedupKey) {
    const prev = byKey.get(entry.dedupKey);
    if (prev && prev !== entry) {
      // Superseded: drop its slot, its unwritten WAL row, and resolve its
      // promise with undefined so callers never wait forever.
      const idx = queue.indexOf(prev);
      if (idx >= 0) queue.splice(idx, 1);
      if (prev.changeId) dropPendingWal(prev.changeId);
      prev.resolve?.(undefined);
    }
    byKey.set(entry.dedupKey, entry);
  }
  queue.push(entry);
  scheduleFlush();
}

/**
 * Queue a persistent live-op: assigns a `changeId`, schedules its WAL write
 * (coalesced by `dedupKey`) and enqueues it for the server push.
 * Returns the assigned changeId.
 */
export function enqueueLiveOp(type: string, payload: unknown, dedupKey?: string): string {
  const changeId = newUuid();
  if (walProjectId) {
    walPending.push({
      id: changeId,
      projectId: walProjectId,
      commandType: type,
      payload,
      enqueuedAt: walNextEnqueuedAt(),
      kind: 'live-op',
      dedupKey,
    });
    scheduleWalWrite();
  }
  enqueuePersist({ type, payload, changeId, dedupKey, kind: 'live-op' });
  return changeId;
}

// ── WAL writes ───────────────────────────────────────────────────────────────

/** Remove a not-yet-written WAL row (its entry was superseded). */
function dropPendingWal(changeId: string): void {
  const idx = walPending.findIndex(e => e.id === changeId);
  if (idx >= 0) walPending.splice(idx, 1);
}

/** Arm the WAL settle timer (no-op if already armed). */
function scheduleWalWrite(): void {
  if (walTimer != null) return;
  walTimer = setTimeout(() => { walTimer = null; void flushPersistWal(); }, WAL_SETTLE_MS);
}

/**
 * Plain-JSON copy of a payload: IndexedDB cannot clone Vue proxies, and the
 * payload is sent as JSON anyway, so this is exactly what the server gets.
 */
function toStorable(entry: WalEntry): WalEntry {
  return { ...entry, payload: JSON.parse(JSON.stringify(entry.payload ?? null)) };
}

/**
 * Write all pending live-op WAL rows now. Resolves once they are durable (or
 * the write failed — failures are logged, the in-memory queue still pushes).
 * Call from unload/visibility handlers to shrink the loss window.
 */
export function flushPersistWal(): Promise<void> {
  if (walTimer != null) { clearTimeout(walTimer); walTimer = null; }
  if (walPending.length > 0) {
    const batch = walPending.splice(0);
    walChain = walChain
      .then(() => walAppendBatch(batch.map(toStorable)))
      .catch(err => console.warn('[persist] WAL write failed:', err));
  }
  return walChain;
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

/** One flush pass: take the queue, make its WAL rows durable, push, ack. */
async function runFlush(hook: PersistHook): Promise<void> {
  // Take the batch first: every entry in it had its WAL row queued before
  // this point, so the WAL flush below covers all of them.
  const batch = queue.splice(0);
  byKey.clear();

  // WAL before network: every live-op row must be durable before it is sent.
  await flushPersistWal();

  try {
    const seqs = await hook(batch.map(e => ({ type: e.type, payload: e.payload, changeId: e.changeId })));
    retryAttempt = 0;
    reportNetworkSuccess();
    for (let i = 0; i < batch.length; i++) batch[i]!.resolve?.(seqs[i]);
    // Ack only entries the server returned a sequence number for; the rest
    // stay in the WAL so the next load's recovery retries them idempotently.
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
 * meanwhile (that newer entry's WAL row already replaced theirs).
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
 * switch to discard ops queued against the previous project. Their WAL rows
 * (already written or flushed here) stay and are recovered on that project's
 * next load. Callers that want them on the server now must
 * `await flushPersistQueue()` first.
 */
export function clearPersistQueue(): void {
  for (const e of queue) e.resolve?.(undefined);
  queue.length = 0;
  byKey.clear();
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
  retryScheduled = false;
  retryAttempt = 0;
  // Keep durability: write any still-pending live-op rows of the old project.
  void flushPersistWal();
}

// ── Connectivity ─────────────────────────────────────────────────────────────

// Back online: reset the backoff and push whatever accumulated offline.
onReconnect(() => {
  retryAttempt = 0;
  retryScheduled = false;
  if (queue.length > 0) scheduleFlush();
});

// Tab hidden (mobile app switch, close): persist pending WAL rows right away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPersistWal();
  });
}
