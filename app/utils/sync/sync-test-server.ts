import { vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { RemoteClient } from '~/utils/sync/remote-api';

/**
 * In-memory fake of the sync edge functions (tests only, ADR 0004 WP-SERVER).
 *
 * One change log with GLOBAL sequence numbers shared by all projects, like
 * `project_changes`. Sequence numbers can be reserved and committed later to
 * emulate two concurrent inserts that become visible out of order (writes
 * that bypass the serialized `push_changes` RPC of migration 009).
 *
 * Models the semantics of migration 009:
 * - `push-change` is idempotent per (project, change id): a duplicate of the
 *   caller's own row returns its stored sequence number; an id stored by
 *   another user is never acknowledged (`null`);
 * - `restore-snapshot` appends a `restore-snapshot` marker change and stores
 *   the restored snapshot at the marker's sequence number;
 * - `load-project` never loads `before offline sync` safety snapshots; among
 *   the rest the highest sequence wins, then the newest;
 * - `save-snapshot` rejects a sequence number above the latest change (400).
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

/** Label of the D5 safety snapshot (never loaded from, like the server). */
const SAFETY_LABEL = 'before offline sync';

/** Marker change type of a restore (migration 009). */
export const RESTORE_MARKER = 'restore-snapshot';

/** Mimics supabase-js `FunctionsHttpError` (Response in `context`). */
function httpError(status: number, message: string): Error & { context: Response } {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  err.name = 'FunctionsHttpError';
  err.context = new Response(JSON.stringify({ error: message }), { status });
  return err;
}

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
  /** Edge functions that answer with this HTTP status (e.g. `save-snapshot` → 500). */
  failing = new Map<string, number>();
  /** Change ids whose `push-change` request fails with this HTTP status (whole request). */
  reject = new Map<string, number>();
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
    const status = this.failing.get(name);
    if (status) {
      // Like supabase-js: an HTTP error carrying the response.
      return { data: null, error: Object.assign(new Error(`${name} failed`), { context: new Response('{"error":"boom"}', { status }) }) };
    }
    switch (name) {
      case 'pull-changes': return { data: this.pull(body), error: null };
      case 'push-change': {
        const refused = (body.changes as Array<{ changeId: string }>).map(c => this.reject.get(c.changeId)).find(Boolean);
        if (refused) return { data: null, error: Object.assign(new Error('rejected'), { context: new Response('{"error":"not allowed"}', { status: refused }) }) };
        return { data: this.push(body), error: null };
      }
      case 'save-snapshot': {
        if (body.sequenceNumber > this.latest(body.projectId)) {
          return { data: null, error: httpError(400, 'sequenceNumber is beyond the latest change') };
        }
        return { data: this.save(body), error: null };
      }
      case 'load-project': return { data: this.load(body), error: null };
      case 'restore-snapshot': return { data: this.restore(body), error: null };
      default: return { data: null, error: new Error(`unknown function ${name}`) };
    }
  }

  /** Highest sequence number of a project (0 without rows). */
  private latest(projectId: string): number {
    return this.rowsOf(projectId).reduce((m, r) => Math.max(m, r.sequence_number), 0);
  }

  /**
   * Snapshot a project loads from: no safety snapshots; highest sequence,
   * then the newest (last stored).
   */
  latestSnapshot(projectId: string): ServerSnapshot | null {
    let best: ServerSnapshot | null = null;
    for (const s of this.snapshots) {
      if (s.project_id !== projectId || s.label === SAFETY_LABEL) continue;
      if (!best || s.sequence_number >= best.sequence_number) best = s;
    }
    return best;
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

  /**
   * `push-change`: idempotent by (project, change id) for the caller's own
   * rows; another user's id and ids in `unconfirm` get `null`.
   */
  private push(body: Record<string, any>) {
    const sequenceNumbers: Array<number | null> = [];
    const changeIds: string[] = [];
    for (const c of body.changes as Array<{ changeId: string; commandType: string; payload: unknown }>) {
      changeIds.push(c.changeId);
      if (this.unconfirm.has(c.changeId)) { sequenceNumbers.push(null); continue; }
      const existing = this.rows.find(r => r.project_id === body.projectId && r.change_id === c.changeId);
      if (existing && existing.user_id !== this.userId) { sequenceNumbers.push(null); continue; }
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

  /**
   * `restore-snapshot`: append a marker change (by the caller) and store the
   * old snapshot at the marker's sequence number.
   */
  private restore(body: Record<string, any>) {
    const old = this.snapshots.find(s => s.id === body.snapshotId && s.project_id === body.projectId);
    if (!old) return null;
    const marker = this.insert(body.projectId, RESTORE_MARKER, { snapshotId: old.id }, { userId: this.userId });
    const head = this.addSnapshot(body.projectId, old.snapshot, marker.sequence_number, `Restored from snapshot ${old.sequence_number}`);
    return {
      snapshot: head.snapshot,
      meta: { id: head.id, sequence_number: head.sequence_number, created_at: head.created_at },
      markerChangeId: marker.change_id,
      sourceSequence: old.sequence_number,
    };
  }
}
