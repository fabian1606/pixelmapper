import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { ProjectStore } from '~/utils/persistence/project-store';
import type { OutboxAccess } from '~/utils/sync/sync-context';
import { packSnapshot, type SyncPosition } from '~/utils/sync/sync-position';

/**
 * Debounced writer of the working snapshot (ADR 0004 §3.1: base + pending
 * changes, the cache that opens a project instantly and offline).
 *
 * The stored snapshot carries the live sync position and the highest outbox
 * `order` it reflects, so reopening replays exactly the outbox rows written
 * after it and pulls skip server changes it already contains. Before
 * capturing, all queued outbox rows are written: a row that is not in the
 * store yet would otherwise get an `order` above the recorded one and be
 * applied twice on the next open.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkingWriterDeps {
  projectId: string;
  store: ProjectStore;
  /** Plain snapshot of the live state. */
  capture(): ProjectSnapshot;
  /** Live sync position (null for local-only projects). */
  position(): SyncPosition | null;
  /** Highest outbox order reflected by the live state. */
  outboxOrder(): number;
  /** Outbox rows not written yet (null for local-only projects). */
  outbox: OutboxAccess | null;
  /** Quiet period after the last change (ms). */
  debounceMs?: number;
  /** Upper bound while changes keep coming (ms). */
  maxWaitMs?: number;
}

export interface WorkingSnapshotWriter {
  /** A change happened: write after the quiet period. */
  schedule(): void;
  /** Write now (unload, project switch, after sync). */
  flush(): Promise<void>;
  /** Cancel timers; later calls are no-ops. */
  dispose(): void;
}

/** Writes per project are serialized across writer instances. */
let writeChain: Promise<void> = Promise.resolve();

// ── Factory ──────────────────────────────────────────────────────────────────

export function createWorkingSnapshotWriter(deps: WorkingWriterDeps): WorkingSnapshotWriter {
  const debounceMs = deps.debounceMs ?? 1000;
  const maxWaitMs = deps.maxWaitMs ?? 5000;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let hard: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let disposed = false;

  /** Clear both timers. */
  function clearTimers(): void {
    if (idle != null) { clearTimeout(idle); idle = null; }
    if (hard != null) { clearTimeout(hard); hard = null; }
  }

  /** Capture and store; never throws. */
  async function write(touchMeta: boolean): Promise<void> {
    try {
      // Make queued outbox rows durable so their orders are known.
      if (deps.outbox) {
        for (let i = 0; i < 10 && deps.outbox.unconfirmed().length > 0; i++) await deps.outbox.flush();
      }
      // Synchronous from here until the snapshot is captured.
      const snapshot = deps.capture();
      const stored = packSnapshot(snapshot, deps.position(), deps.outboxOrder());
      await deps.store.putWorkingSnapshot(deps.projectId, stored);
      if (touchMeta) {
        const meta = await deps.store.getProject(deps.projectId);
        if (meta) await deps.store.putProject({ ...meta, updatedAt: Date.now() });
      }
    }
    catch (err) {
      console.warn('[sync] writing the working snapshot failed:', err);
    }
  }

  /** Write now; serialized with every other working-snapshot write. */
  function flush(): Promise<void> {
    if (disposed) return writeChain;
    clearTimers();
    const touchMeta = dirty;
    dirty = false;
    writeChain = writeChain.then(() => write(touchMeta));
    return writeChain;
  }

  return {
    schedule() {
      if (disposed) return;
      dirty = true;
      if (idle != null) clearTimeout(idle);
      idle = setTimeout(() => { void flush(); }, debounceMs);
      if (hard == null) hard = setTimeout(() => { void flush(); }, maxWaitMs);
    },
    flush,
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
