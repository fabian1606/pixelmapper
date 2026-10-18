/**
 * Outbox writer — the durable half of the persist path (ADR 0004 D8, §3.1).
 *
 * Every persisted change (history command or persistent live-op) of a cloud
 * project is appended to the `ProjectStore` outbox here BEFORE it is sent.
 * Rows are written by one serialized chain, so their store-assigned `order`
 * equals the order in which the changes were made:
 *
 * - live-op rows are batched over `OUTBOX_SETTLE_MS` and coalesced by
 *   `dedupKey` (a 60 Hz drag causes ~20 IndexedDB transactions per second);
 * - a history command flushes the batch immediately (it is never coalesced
 *   and must be durable right away).
 *
 * Rows that are queued or being written are "unconfirmed"; the sync engine
 * reads them together with the stored outbox so a rebase never misses a
 * change that is already applied to the live state.
 *
 * Replaces the old IndexedDB WAL (`pixelmapper-wal`), whose rows are moved
 * into the outbox once by `migrateLegacyWal`.
 */
import { getProjectStore, type NewOutboxEntry, type ProjectStore } from '~/utils/persistence/project-store';
import { backoffDelay } from '~/utils/sync/connectivity';

// ── Constants ────────────────────────────────────────────────────────────────

/** Window in which live-op outbox writes are coalesced. */
export const OUTBOX_SETTLE_MS = 50;

// ── State ────────────────────────────────────────────────────────────────────

/** Rows waiting for the next write (coalesced by dedupKey). */
const pending: NewOutboxEntry[] = [];
/** Rows of the batch currently being written. */
let writing: NewOutboxEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Consecutive failed batch writes (input for `backoffDelay`). */
let failedWrites = 0;
/** Serializes writes so transactions are created in enqueue order. */
let chain: Promise<void> = Promise.resolve();
/** Highest outbox `order` assigned per project in this session. */
const lastOrder = new Map<string, number>();
/** Listeners notified after rows were written (pending-count UI). */
const writtenListeners = new Set<(projectId: string) => void>();
/** Last `enqueuedAt` handed out (strictly increasing). */
let lastEnqueuedAt = 0;
/** Store override for tests. */
let storeOverride: ProjectStore | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strictly increasing timestamp (ms) for `enqueuedAt`. */
export function nextEnqueuedAt(): number {
  const now = Date.now();
  lastEnqueuedAt = now > lastEnqueuedAt ? now : lastEnqueuedAt + 1;
  return lastEnqueuedAt;
}

/**
 * Plain-JSON copy of a row: IndexedDB cannot clone Vue proxies, and the
 * payload is sent as JSON anyway, so this is exactly what the server gets.
 */
function toStorable(row: NewOutboxEntry): NewOutboxEntry {
  return { ...row, payload: JSON.parse(JSON.stringify(row.payload ?? null)) };
}

/** The store rows are written to. */
function resolveStore(): Promise<ProjectStore> {
  return storeOverride ? Promise.resolve(storeOverride) : getProjectStore();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Queue an outbox row. A row with a `dedupKey` replaces a still-unwritten row
 * of the same project and key (the store replaces an already written one).
 * `immediate` writes the batch now instead of after the settle window.
 */
export function queueOutboxRow(row: Omit<NewOutboxEntry, 'enqueuedAt'>, immediate = false): void {
  if (row.dedupKey) {
    const idx = pending.findIndex(r => r.projectId === row.projectId && r.dedupKey === row.dedupKey);
    if (idx >= 0) pending.splice(idx, 1);
  }
  pending.push({ ...row, enqueuedAt: nextEnqueuedAt() });
  if (immediate) { void flushOutboxWrites(); return; }
  if (timer == null) {
    timer = setTimeout(() => { timer = null; void flushOutboxWrites(); }, OUTBOX_SETTLE_MS);
  }
}

/** Remove a not-yet-written row (its change was superseded in memory). */
export function dropUnwrittenOutboxRow(id: string): void {
  const idx = pending.findIndex(r => r.id === id);
  if (idx >= 0) pending.splice(idx, 1);
}

/**
 * Write all queued rows now. Resolves once they are durable, or once the
 * write failed: failures are logged and the unwritten rows go back to the
 * front of the queue (still "unconfirmed", so no checkpoint drops them) and
 * are retried with backoff.
 */
export function flushOutboxWrites(): Promise<void> {
  if (timer != null) { clearTimeout(timer); timer = null; }
  if (pending.length > 0) {
    const batch = pending.splice(0).map(toStorable);
    chain = chain.then(() => writeBatch(batch));
  }
  return chain;
}

/** Append one batch in order; tracks the assigned orders. */
async function writeBatch(batch: NewOutboxEntry[]): Promise<void> {
  writing = batch;
  const touched = new Set<string>();
  let written = 0;
  try {
    const store = await resolveStore();
    for (const row of batch) {
      const stored = await store.appendOutbox(row);
      lastOrder.set(row.projectId, Math.max(lastOrder.get(row.projectId) ?? 0, stored.order));
      touched.add(row.projectId);
      written++;
    }
    failedWrites = 0;
  }
  catch (err) {
    console.warn('[outbox] write failed:', err);
    requeueUnwritten(batch.slice(written));
  }
  finally {
    writing = [];
    for (const projectId of touched) notifyWritten(projectId);
  }
}

/**
 * Put rows whose write failed back in front of the queue (order kept) and
 * retry with backoff. Without this they would be lost: the sync engine only
 * pushes stored rows. A row superseded meanwhile (same project + dedupKey
 * queued again) is dropped; its newer row carries the change.
 */
function requeueUnwritten(rows: NewOutboxEntry[]): void {
  const keep = rows.filter(r => !r.dedupKey || !pending.some(p => p.projectId === r.projectId && p.dedupKey === r.dedupKey));
  pending.unshift(...keep);
  if (pending.length === 0 || timer != null) return;
  timer = setTimeout(() => { timer = null; void flushOutboxWrites(); }, backoffDelay(failedWrites++));
}

/** Notify listeners; a failing listener never breaks the write chain. */
function notifyWritten(projectId: string): void {
  for (const cb of writtenListeners) {
    try { cb(projectId); }
    catch (err) { console.warn('[outbox] listener failed:', err); }
  }
}

/** Rows of `projectId` that are queued or being written, in enqueue order. */
export function getUnconfirmedOutboxRows(projectId: string): NewOutboxEntry[] {
  return [...writing, ...pending].filter(r => r.projectId === projectId);
}

/** True while rows are queued or being written. */
export function hasUnconfirmedOutboxRows(): boolean {
  return pending.length > 0 || writing.length > 0;
}

/** Highest `order` this session assigned to a row of `projectId` (0 if none). */
export function lastAppendedOutboxOrder(projectId: string): number {
  return lastOrder.get(projectId) ?? 0;
}

/** Subscribe to "rows were written for project X"; returns an unsubscribe. */
export function onOutboxWritten(cb: (projectId: string) => void): () => void {
  writtenListeners.add(cb);
  return () => { writtenListeners.delete(cb); };
}

/** Tests only: write into `store` instead of the shared singleton (null resets). */
export function setOutboxStoreForTests(store: ProjectStore | null): void {
  storeOverride = store;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

// Tab hidden (mobile app switch, close): make queued rows durable right away.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushOutboxWrites();
  });
}
