/**
 * Batch scheduler of tube firmware updates (plan D17): one job per node
 * port at a time, ports in parallel, the next tube of a port starts when
 * the previous job ended — also when it failed — and everything can be
 * cancelled. No Vue: the reactive wrapper is `FirmwareUpdateManager`.
 *
 * Jobs belong to the bridge (contract §6 `flash`): they continue when the
 * app disconnects and their progress (`flashProgress`) reaches every
 * connection. The scheduler therefore
 * - matches progress by `jobId`, or — while the `flash` command is still
 *   open — by node, port and UID ("adoption"),
 * - shows jobs started elsewhere (another window, before a reload) as
 *   attached items that hold their port like its own ones,
 * - resolves its state from a full `flashJobs` snapshot (`sync`) after a
 *   reconnect or a lost `flash` answer.
 * The queue itself lives in the app: tubes not started yet are lost on
 * reload.
 */
import { BridgeCommandError } from '../bridge/backend';
import type { FirmwareImageInfo, FlashJob, NodeId, PortRef, RdmUid } from '../bridge/protocol-model';
import { portKey, samePort } from '../bridge/protocol-model';
import { describeFlashError, describeJobError, type FlashErrorText } from './firmware-errors';
import { holdsPort, isItemPending, type FlashItem, type FlashItemStatus, type FlashRequest, type FlashSchedulerOptions } from './flash-item';
import { isTerminalPhase } from './flash-progress';

/** Internal, mutable item. */
interface Entry {
  key: number;
  nodeId: NodeId;
  port: PortRef;
  uid: RdmUid;
  allowDowngrade: boolean;
  image: FirmwareImageInfo | null;
  ours: boolean;
  status: FlashItemStatus;
  job: FlashJob | null;
  error: string | null;
  errorDetail: string | null;
  /** Image content (own items only; dropped once started). */
  hex: string | null;
  /** Cancel as soon as the job id is known. */
  cancelRequested: boolean;
  /** The `flash` answer was lost; the next `sync` decides. */
  lost: FlashErrorText | null;
  /** Jobs that existed before this item was started (never adopted). */
  ignoreJobIds: ReadonlySet<string>;
}

/** Lane of a port: one job per (node, port). */
function laneOf(item: { nodeId: NodeId; port: PortRef }): string {
  return `${item.nodeId}|${portKey(item.port)}`;
}

/** True when the job runs on the item's tube. */
function sameTarget(entry: Entry, job: FlashJob): boolean {
  return entry.uid === job.uid && entry.nodeId === job.nodeId && samePort(entry.port, job.port);
}

/** Item status of a job phase (running phases → `running`). */
function statusOfPhase(job: FlashJob): FlashItemStatus {
  return job.phase === 'done' || job.phase === 'failed' || job.phase === 'cancelled' ? job.phase : 'running';
}

/** Read-only copy of an entry. */
function toItem(e: Entry): FlashItem {
  return {
    key: e.key, nodeId: e.nodeId, port: e.port, uid: e.uid, allowDowngrade: e.allowDowngrade, image: e.image,
    ours: e.ours, status: e.status, job: e.job, error: e.error, errorDetail: e.errorDetail,
  };
}

/** `ignoreJobIds` of items that were not started yet. */
const NO_JOBS: ReadonlySet<string> = new Set();

/** Queue and state of all firmware updates of one bridge (see file comment). */
export class FlashScheduler {
  private entries: Entry[] = [];
  private seq = 0;
  /** Every job id seen so far (events, results, snapshots). */
  private seen = new Set<string>();
  private isPaused: boolean;

  constructor(private readonly options: FlashSchedulerOptions) {
    this.isPaused = options.paused ?? false;
  }

  // ── Reading ──────────────────────────────────

  /** All items in the order they were added. */
  items(): FlashItem[] {
    return this.entries.map(toItem);
  }

  /** True while nothing new is started. */
  get paused(): boolean {
    return this.isPaused;
  }

  // ── Commands ─────────────────────────────────

  /**
   * Queues one update per request (tubes with a pending update are skipped)
   * and starts what can start. Older finished items of the same tubes are
   * dropped. Returns the new items.
   */
  enqueue(requests: readonly FlashRequest[], hex: string): FlashItem[] {
    const created: Entry[] = [];
    for (const r of requests) {
      if (this.entries.some(e => e.uid === r.uid && isItemPending(e))) continue;
      this.dropFinished(r.uid);
      const entry = this.newEntry({ ...r, port: { bind: r.port.bind, index: r.port.index } }, true, hex);
      this.entries.push(entry);
      created.push(entry);
    }
    this.pump();
    this.changed();
    return created.map(toItem);
  }

  /**
   * Cancels the pending items `filter` accepts (all by default): queued ones
   * never start, running ones get `flashCancel` (the tube stays in its
   * bootloader, contract §9.1). Resolves when the cancel requests answered.
   */
  async cancel(filter: (item: FlashItem) => boolean = () => true): Promise<void> {
    const calls: Promise<void>[] = [];
    for (const e of this.entries) {
      if (!isItemPending(e) || !filter(toItem(e))) continue;
      if (e.status === 'queued') {
        e.status = 'cancelled';
        e.hex = null;
      }
      else if (e.status === 'starting') e.cancelRequested = true;
      else if (e.status === 'running') {
        e.cancelRequested = true;
        calls.push(this.requestCancel(e));
      }
    }
    this.pump();
    this.changed();
    await Promise.all(calls);
  }

  /** Stops starting new jobs (e.g. while the bridge is away). */
  pause(): void {
    this.isPaused = true;
  }

  /** Starts what can start again. */
  resume(): void {
    this.isPaused = false;
    this.pump();
    this.changed();
  }

  // ── Bridge input ─────────────────────────────

  /** Applies a `flashProgress` event. */
  handleProgress(job: FlashJob): void {
    this.apply(job);
    this.pump();
    this.changed();
  }

  /**
   * Applies a complete `flashJobs` snapshot (running and finished jobs of
   * the last 10 minutes): updates known jobs, adopts jobs of items whose
   * `flash` answer was lost, attaches jobs started elsewhere and fails
   * running items the bridge no longer knows (bridge restarted).
   */
  sync(jobs: readonly FlashJob[]): void {
    const byId = new Map(jobs.map(j => [j.jobId, j]));
    for (const e of this.entries) {
      if (!e.job || !holdsPort(e) || byId.has(e.job.jobId)) continue;
      if (e.status === 'cancelling') e.status = 'cancelled';
      else this.fail(e, { message: 'The bridge no longer reports this update (was it restarted?)', detail: null });
    }
    // Finished jobs newest first (assuming the bridge lists jobs in start order; the
    // contract does not say), so only a tube's latest result is attached; running
    // jobs last, so they replace it.
    const ordered = [...jobs.filter(j => isTerminalPhase(j.phase)).reverse(), ...jobs.filter(j => !isTerminalPhase(j.phase))];
    for (const job of ordered) this.apply(job, true);
    for (const e of this.entries) {
      if (e.status !== 'starting' || e.job || !e.lost) continue;
      // The `flash` answer was lost and the bridge has no job for it: it never started.
      if (e.cancelRequested) e.status = 'cancelled';
      else this.fail(e, e.lost);
      e.lost = null;
    }
    this.pump();
    this.changed();
  }

  // ── Internals ────────────────────────────────

  /** Creates an entry. */
  private newEntry(r: FlashRequest, ours: boolean, hex: string | null): Entry {
    return {
      key: ++this.seq, nodeId: r.nodeId, port: r.port, uid: r.uid, allowDowngrade: r.allowDowngrade, image: r.image,
      ours, status: 'queued', job: null, error: null, errorDetail: null, hex, cancelRequested: false, lost: null, ignoreJobIds: NO_JOBS,
    };
  }

  /** Routes a job to its item, adopts it or attaches it. */
  private apply(job: FlashJob, fromSnapshot = false): void {
    this.seen.add(job.jobId);
    const own = this.entries.find(e => e.job?.jobId === job.jobId)
      ?? this.entries.find(e => e.status === 'starting' && !e.job && sameTarget(e, job) && !e.ignoreJobIds.has(job.jobId));
    if (own) {
      own.lost = null;
      this.update(own, job);
      return;
    }
    this.attach(job, fromSnapshot);
  }

  /**
   * Shows a job started elsewhere. Running jobs always (they hold the
   * port); finished ones only as the tube's latest result.
   */
  private attach(job: FlashJob, fromSnapshot: boolean): void {
    const latest = this.entries.filter(e => e.uid === job.uid);
    if (isTerminalPhase(job.phase)) {
      if (latest.some(isItemPending)) return;
      // From a snapshot, a finished job only fills in tubes without any item.
      if (fromSnapshot && latest.length > 0) return;
    }
    this.dropFinished(job.uid);
    const entry = this.newEntry({ nodeId: job.nodeId, port: { ...job.port }, uid: job.uid, allowDowngrade: false, image: job.image }, false, null);
    this.update(entry, job);
    this.entries.push(entry);
  }

  /** Takes over the job's state (never back from a finished phase of the same job). */
  private update(e: Entry, job: FlashJob): void {
    if (e.job?.jobId === job.jobId && isTerminalPhase(e.job.phase) && !isTerminalPhase(job.phase)) return;
    e.job = job;
    e.image = job.image;
    e.hex = null;
    const status = statusOfPhase(job);
    if (status === 'failed') {
      const text = describeJobError(job.error);
      e.error = text.message;
      e.errorDetail = text.detail;
    }
    e.status = status === 'running' && e.status === 'cancelling' ? 'cancelling' : status;
    if (e.status === 'running' && e.cancelRequested) void this.requestCancel(e);
  }

  /** Marks an item failed. */
  private fail(e: Entry, text: FlashErrorText): void {
    e.status = 'failed';
    e.error = text.message;
    e.errorDetail = text.detail;
    e.hex = null;
  }

  /** Sends `flashCancel` for a running item. */
  private async requestCancel(e: Entry): Promise<void> {
    const jobId = e.job?.jobId;
    if (!jobId) return;
    e.status = 'cancelling';
    try {
      await this.options.runner.cancel(jobId);
    }
    catch (err) {
      // `unknownJob`: the job already ended; its last event or the next sync settles the item.
      if (!(err instanceof BridgeCommandError && err.code === 'unknownJob')) console.warn('[artnet] firmware cancel failed:', err);
    }
  }

  /** Starts the first queued item of every free port. */
  private pump(): void {
    if (this.isPaused) return;
    const busy = new Set(this.entries.filter(e => holdsPort(e)).map(laneOf));
    for (const e of this.entries) {
      if (e.status !== 'queued' || busy.has(laneOf(e))) continue;
      busy.add(laneOf(e));
      this.start(e);
    }
  }

  /** Sends `flash` for an item. */
  private start(e: Entry): void {
    const hex = e.hex ?? '';
    e.status = 'starting';
    e.ignoreJobIds = new Set(this.seen);
    let started: Promise<FlashJob>;
    try {
      started = this.options.runner.start({ nodeId: e.nodeId, port: e.port, uid: e.uid, allowDowngrade: e.allowDowngrade, image: e.image, hex });
    }
    catch (err) {
      started = Promise.reject(err);
    }
    started.then(job => this.onStarted(e, job), err => this.onStartFailed(e, err));
  }

  /** `flash` answered with the job. */
  private onStarted(e: Entry, job: FlashJob): void {
    if (!this.entries.includes(e)) return;
    this.seen.add(job.jobId);
    e.lost = null;
    this.update(e, job);
    this.pump();
    this.changed();
  }

  /** `flash` failed (pre-check error, connection lost, …). */
  private onStartFailed(e: Entry, err: unknown): void {
    if (!this.entries.includes(e) || e.status !== 'starting' || e.job) return;
    const code = err instanceof BridgeCommandError ? err.code : null;
    if (code === 'disconnected' || code === 'requestTimeout') {
      // The job may run anyway; the next `flashJobs` snapshot tells.
      e.lost = describeFlashError(err);
      this.changed();
      this.options.onLost?.();
      return;
    }
    if (e.cancelRequested) e.status = 'cancelled';
    else if (code === 'busy' && this.portHeldByOther(e)) e.status = 'queued'; // waits for the other job
    else this.fail(e, describeFlashError(err));
    e.hex = e.status === 'queued' ? e.hex : null;
    this.pump();
    this.changed();
  }

  /** True when another item holds the item's port. */
  private portHeldByOther(e: Entry): boolean {
    return this.entries.some(o => o !== e && holdsPort(o) && laneOf(o) === laneOf(e));
  }

  /** Drops finished items of a tube (the newest item replaces them). */
  private dropFinished(uid: RdmUid): void {
    this.entries = this.entries.filter(e => e.uid !== uid || isItemPending(e));
  }

  /** Notifies the owner. */
  private changed(): void {
    this.options.onChange?.();
  }
}
