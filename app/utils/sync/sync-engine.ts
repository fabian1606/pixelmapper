import { watch } from 'vue';
import { isCurrentAccount } from '~/utils/auth/current-account';
import { isOnline, onReconnect } from '~/utils/sync/connectivity';
import { setSyncStatus } from '~/utils/sync/project-sync-service';
import { reportSyncConflicts } from '~/utils/sync/sync-conflicts';
import type { BaseState, SyncDeps, SyncState } from '~/utils/sync/sync-context';
import { pullStep } from '~/utils/sync/sync-cycle';
import type { SyncPosition } from '~/utils/sync/sync-position';
import { checkpointBase, pushOutbox, touchLastSynced } from '~/utils/sync/sync-push';
import { describeStatus } from '~/utils/sync/sync-status';
import { guardSyncDeps } from '~/utils/sync/sync-guard';
import { RealtimeIntake, type RemoteApplier, type RemoteInsert } from '~/utils/sync/sync-realtime';

export type { RemoteApplier, RemoteInsert } from '~/utils/sync/sync-realtime';

/**
 * SyncEngine — one per open cloud project (ADR 0004 §3, D4, D5, D9, D17).
 *
 * - Owns every network operation of the project behind one lock: sync
 *   cycles (pull → apply/rebase → push) and plain pushes requested by the
 *   persist queue.
 * - The outbox is the source of truth for what is pushed; the persist queue
 *   only triggers pushes and receives sequence numbers.
 * - Realtime inserts (CDC) are a fast path: they are applied and recorded by
 *   change id; pulls stay authoritative and dedupe against them.
 * - Triggers: open, reconnect, realtime (re)subscribe, periodic fallback.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyncEngineInit {
  base: BaseState | null;
  live: SyncPosition;
  /** Pending outbox rows from an earlier session exist (rebase on first sync). */
  backlog: boolean;
}

/** Thrown to the persist queue when a push needs the network. */
class OfflineError extends TypeError {
  constructor() { super('Failed to fetch (offline)'); }
}

/** Default fallback pull interval while a project is open. */
const PERIODIC_MS = 60_000;

/** Longest wait in `stop()` for a running operation (hanging requests). */
const STOP_WAIT_MS = 5_000;

// ── Engine ───────────────────────────────────────────────────────────────────

export class SyncEngine {
  readonly projectId: string;
  private readonly deps: SyncDeps;
  private readonly state: SyncState;
  private lock: Promise<unknown> = Promise.resolve();
  private queuedCycle: Promise<void> | null = null;
  private cycleRunning = false;
  private initialSyncDone = false;
  private readonly realtime: RealtimeIntake;
  private stopped = false;
  private disposers: Array<() => void> = [];

  constructor(deps: SyncDeps, init: SyncEngineInit) {
    // Every side effect is gated: nothing runs after stop() or once another
    // account (or nobody) is signed in, even from an operation in flight.
    this.deps = guardSyncDeps(deps, () => this.canSync());
    this.projectId = deps.projectId;
    this.state = {
      base: init.base,
      live: init.live,
      backlog: init.backlog,
      ownIds: new Set(),
      ackedSeq: new Map(),
      safety: null,
      safetySnapshotId: null,
      conflicts: null,
      lastError: null,
      lastSyncedAt: null,
    };
    this.realtime = new RealtimeIntake(() => this.state, this.deps);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Wire triggers and run the initial sync (if online). */
  start(): void {
    this.disposers.push(onReconnect(() => { void this.requestSync(); }));
    // Going offline: whatever is edited from now on is backlog (rebase later).
    this.disposers.push(watch(isOnline, (online) => {
      if (!online) this.state.backlog = true;
      void this.refreshStatus();
    }));
    const timer = setInterval(() => { void this.requestSync(); }, this.deps.periodicMs ?? PERIODIC_MS);
    this.disposers.push(() => clearInterval(timer));
    void this.requestSync();
  }

  /**
   * Stop all triggers (project closed, sign-out) and wait for the running
   * operation, at most `STOP_WAIT_MS`. Whatever is still in flight after
   * that can no longer touch the live state, the store or the server (the
   * guarded deps throw), so the next project is never written to.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const d of this.disposers.splice(0)) d();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS); });
    await Promise.race([this.lock, timeout]);
    clearTimeout(timer);
  }

  /** Not stopped and the bound account is (still) the signed-in one. */
  canSync(): boolean {
    return !this.stopped && isCurrentAccount(this.deps.userId);
  }

  /** Account this engine syncs as (the project's `ownerUserId`). */
  get boundUserId(): string {
    return this.deps.userId;
  }

  /** Pending changes need a rebase before they may be pushed. */
  hasBacklog(): boolean {
    return this.state.backlog;
  }

  /** Pull and push everything now (logout, D15/D16). */
  flushNow(): Promise<void> {
    return this.requestSync();
  }

  /** Live position (written with the working snapshot). */
  livePosition(): SyncPosition {
    return this.state.live;
  }

  /** Realtime applier from the collaboration layer. */
  setRemoteApplier(fn: RemoteApplier | null): void {
    this.realtime.setApplier(fn);
  }

  // ── Lock ───────────────────────────────────────────────────────────────────

  /** Run `fn` after every earlier network operation of this engine. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ── Sync cycle ─────────────────────────────────────────────────────────────

  /** Run a sync cycle; concurrent requests share one queued cycle. */
  requestSync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.queuedCycle) return this.queuedCycle;
    const cycle = this.exclusive(async () => {
      this.queuedCycle = null;
      await this.cycle();
    });
    this.queuedCycle = cycle;
    return cycle;
  }

  /** Pull → apply/rebase → push → checkpoint (§3.2). Lock held. */
  private async cycle(): Promise<void> {
    // Stopped, or another account signed in on this tab: never sync as it.
    if (!this.canSync()) return;
    if (!isOnline.value) { await this.refreshStatus(); return; }
    this.cycleRunning = true;
    setSyncStatus({ state: 'syncing' });
    try {
      const pulled = await pullStep(this.deps, this.state);
      // The live state was rebased: undo/redo entries refer to the old one.
      if (pulled.ok && pulled.rebased) this.deps.onRebased?.();
      if (!pulled.ok || !this.canSync()) return;
      await this.pushAndSettle();
    }
    catch (err) {
      console.warn('[sync] cycle failed:', err);
    }
    finally {
      this.cycleRunning = false;
      if (this.canSync()) this.realtime.drain();
      await this.refreshStatus();
    }
  }

  /** Push the outbox; on success clear the backlog, report conflicts, checkpoint. */
  private async pushAndSettle(): Promise<boolean> {
    if (!this.canSync()) return false;
    const pushed = await pushOutbox(this.deps, this.state);
    if (!this.canSync()) return false;
    if (!pushed) {
      if (this.state.lastError?.kind === 'network') this.state.backlog = true;
      return false;
    }
    this.state.backlog = false;
    this.initialSyncDone = true;
    this.reportConflicts();
    await checkpointBase(this.deps, this.state);
    await touchLastSynced(this.deps, this.state, Date.now());
    return true;
  }

  /** Hand the conflicts of the last rebase to the UI (after its push). */
  private reportConflicts(): void {
    const conflicts = this.state.conflicts;
    if (!conflicts) return;
    this.state.conflicts = null;
    const snapshotId = this.state.safetySnapshotId;
    const restore = this.deps.restoreBeforeSync;
    reportSyncConflicts({
      projectId: this.projectId,
      items: conflicts.items,
      state: conflicts.state,
      canRestore: !!snapshotId && !!restore,
      restore: async () => (snapshotId && restore ? restore(snapshotId) : false),
    });
  }

  // ── Persist-queue hook ─────────────────────────────────────────────────────

  /**
   * Push hook of the persist queue. Runs a full cycle while a backlog exists
   * (so stale payloads are rebased first), otherwise pushes the outbox.
   * Resolves with the sequence number per requested change id; throws a
   * network error while offline so the queue waits for reconnect.
   */
  async pushForQueue(changeIds: Array<string | undefined>): Promise<Array<number | undefined>> {
    // Like offline: the rows stay in the outbox for the owner's next session.
    if (!isOnline.value || !this.canSync()) throw new OfflineError();
    await this.exclusive(async () => {
      if (this.state.backlog || !this.initialSyncDone) await this.cycle();
      else {
        await this.pushAndSettle();
        await this.refreshStatus();
      }
    });
    const err = this.state.lastError;
    if (err?.retryable) throw err.kind === 'network' ? new OfflineError() : new Error(err.message);
    return changeIds.map(id => (id ? this.state.ackedSeq.get(id) : undefined));
  }

  // ── Realtime ───────────────────────────────────────────────────────────────

  /** CDC insert: dedupe by change id, apply foreign changes. */
  handleRemoteInsert(row: RemoteInsert): void {
    if (this.stopped) return;
    // A running cycle may replace the live state: decide afterwards.
    this.realtime.handle(row, this.cycleRunning);
  }

  /** Realtime (re)subscribed: events may have been missed → pull. */
  handleRealtimeSubscribed(): void {
    void this.requestSync();
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /** Recompute the header status from the outbox and the last result. */
  async refreshStatus(): Promise<void> {
    if (this.stopped) return;
    let pending = 0;
    try { pending = await this.deps.store.countPending(this.projectId) + this.deps.outbox.unconfirmed().length; }
    catch { pending = 0; }
    setSyncStatus(describeStatus({
      online: isOnline.value,
      running: this.cycleRunning,
      pending,
      error: this.state.lastError,
      lastSyncedAt: this.state.lastSyncedAt,
    }));
  }
}
