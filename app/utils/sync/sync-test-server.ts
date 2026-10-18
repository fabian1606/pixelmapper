import { vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { RemoteClient } from '~/utils/sync/remote-api';

/**
 * In-memory fake of the sync edge functions (tests only, ADR 0004 WP-SERVER).
 *
 * One change log with GLOBAL sequence numbers shared by all projects, like
 * `project_changes`. Sequence numbers can be reserved and committed later to
 * emulate two concurrent inserts that become visible out of order.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A `project_changes` row as the edge functions return it (snake_case). */
export interface ServerRow {
  project_id: string;
  sequence_number: number;
  change_id: string;
  user_id: string;
  command_type: string;
  payload: unknown;
  created_at: string;
}

/** A stored server snapshot. */
export interface ServerSnapshot {
  id: string;
  project_id: string;
  sequence_number: number;
  label: string | null;
  snapshot: ProjectSnapshot;
  created_at: string;
}

/** One recorded edge-function call. */
export interface ServerCall {
  name: string;
  body: Record<string, any>;
}

const NOW = '2026-10-18T10:00:00Z';

// ── Server ───────────────────────────────────────────────────────────────────

export class FakeSyncServer {
  rows: ServerRow[] = [];
  snapshots: ServerSnapshot[] = [];
  calls: ServerCall[] = [];
  /** When true every call rejects like `fetch` without network. */
  offline = false;
  /** Account of the caller (author of pushed rows). */
  userId = 'u-me';
  /** Row cap of the `load-project` tail (server-side truncation). */
  tailCap = Number.POSITIVE_INFINITY;
  /** Change ids the server refuses to confirm (`sequenceNumber: null`). */
  unconfirm = new Set<string>();
  private nextSeq = 1;
  private nextSnapshotId = 1;

  /** Supabase-like client; `invoke` is a spy. */
  readonly client: RemoteClient & { functions: { invoke: ReturnType<typeof vi.fn> } } = {
    functions: { invoke: vi.fn((name: string, opts?: { body?: Record<string, unknown> }) => this.invoke(name, opts?.body ?? {})) },
  };

  // ── Test setup ─────────────────────────────────────────────────────────────

  /** Reserve a sequence number whose row commits later (`commit`). */
  reserve(): number {
    return this.nextSeq++;
  }

  /** Insert a row now (a foreign client's change by default). */
  insert(projectId: string, commandType: string, payload: unknown, opts: { changeId?: string; userId?: string; seq?: number } = {}): ServerRow {
    const row: ServerRow = {
      project_id: projectId,
      sequence_number: opts.seq ?? this.nextSeq++,
      change_id: opts.changeId ?? `chg-${Math.random().toString(36).slice(2)}`,
      user_id: opts.userId ?? 'u-other',
      command_type: commandType,
      payload: JSON.parse(JSON.stringify(payload)),
      created_at: NOW,
    };
    this.rows.push(row);
    this.rows.sort((a, b) => a.sequence_number - b.sequence_number);
    return row;
  }

  /** Store a snapshot at `seq` (setup or `save-snapshot`). */
  addSnapshot(projectId: string, snapshot: ProjectSnapshot, seq: number, label: string | null = null): ServerSnapshot {
    const snap: ServerSnapshot = {
      id: `snap-${this.nextSnapshotId++}`,
      project_id: projectId,
      sequence_number: seq,
      label,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      created_at: NOW,
    };
    this.snapshots.push(snap);
    return snap;
  }

  /** Rows of one project, ascending. */
  rowsOf(projectId: string): ServerRow[] {
    return this.rows.filter(r => r.project_id === projectId);
  }

  /** Names of the calls made so far, in order. */
  callNames(): string[] {
    return this.calls.map(c => c.name);
  }

  // ── Edge functions ─────────────────────────────────────────────────────────

  /** Dispatch one `functions.invoke` call. */
  private async invoke(name: string, body: Record<string, any>): Promise<{ data: unknown; error: unknown }> {
    this.calls.push({ name, body: JSON.parse(JSON.stringify(body)) });
    if (this.offline) throw new TypeError('Failed to fetch');
    switch (name) {
      case 'pull-changes': return { data: this.pull(body), error: null };
      case 'push-change': return { data: this.push(body), error: null };
      case 'save-snapshot': return { data: this.save(body), error: null };
      case 'load-project': return { data: this.load(body), error: null };
      case 'restore-snapshot': return { data: this.restore(body), error: null };
      default: return { data: null, error: new Error(`unknown function ${name}`) };
    }
  }

  /** Highest sequence number of a project (0 without rows). */
  private latest(projectId: string): number {
    return this.rowsOf(projectId).reduce((m, r) => Math.max(m, r.sequence_number), 0);
  }

  /** Latest snapshot of a project (last stored wins). */
  private latestSnapshot(projectId: string): ServerSnapshot | null {
    const own = this.snapshots.filter(s => s.project_id === projectId);
    return own.length > 0 ? own[own.length - 1]! : null;
  }

  /** `pull-changes`: one page after `afterSequence`. */
  private pull(body: Record<string, any>) {
    const after = body.afterSequence as number;
    const limit = (body.limit as number | undefined) ?? 500;
    const all = this.rowsOf(body.projectId).filter(r => r.sequence_number > after);
    const page = all.slice(0, limit);
    return {
      changes: page,
      hasMore: all.length > page.length,
      nextAfterSequence: page.length > 0 ? page[page.length - 1]!.sequence_number : after,
      latestSequence: this.latest(body.projectId),
      snapshotSequence: this.latestSnapshot(body.projectId)?.sequence_number ?? 0,
    };
  }

  /** `push-change`: idempotent by change id; unconfirmed ids get `null`. */
  private push(body: Record<string, any>) {
    const sequenceNumbers: Array<number | null> = [];
    const changeIds: string[] = [];
    for (const c of body.changes as Array<{ changeId: string; commandType: string; payload: unknown }>) {
      changeIds.push(c.changeId);
      if (this.unconfirm.has(c.changeId)) { sequenceNumbers.push(null); continue; }
      const existing = this.rows.find(r => r.change_id === c.changeId);
      const row = existing ?? this.insert(body.projectId, c.commandType, c.payload, { changeId: c.changeId, userId: this.userId });
      sequenceNumbers.push(row.sequence_number);
    }
    return { sequenceNumbers, changeIds };
  }

  /** `save-snapshot`: record and return the meta row. */
  private save(body: Record<string, any>) {
    const s = this.addSnapshot(body.projectId, body.snapshot, body.sequenceNumber, body.label ?? null);
    return { id: s.id, sequence_number: s.sequence_number, label: s.label, created_at: s.created_at };
  }

  /** `load-project`: latest snapshot + (capped) tail. */
  private load(body: Record<string, any>) {
    const snap = this.latestSnapshot(body.projectId);
    const from = snap?.sequence_number ?? 0;
    const tail = this.rowsOf(body.projectId).filter(r => r.sequence_number > from);
    return {
      snapshot: snap ? { ...snap.snapshot } : null,
      snapshotSequence: from,
      tail: tail.slice(0, Number.isFinite(this.tailCap) ? this.tailCap : tail.length),
      latestSequence: this.latest(body.projectId),
    };
  }

  /** `restore-snapshot`: copy an old snapshot to the head of the log. */
  private restore(body: Record<string, any>) {
    const old = this.snapshots.find(s => s.id === body.snapshotId);
    if (!old) return null;
    const head = this.addSnapshot(body.projectId, old.snapshot, this.latest(body.projectId), 'restored');
    return { snapshot: head.snapshot, meta: { id: head.id, sequence_number: head.sequence_number } };
  }
}
