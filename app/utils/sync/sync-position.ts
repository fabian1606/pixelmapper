import type { ProjectSnapshot } from '~/utils/engine/serialize';

/**
 * Sync position: which server changes a snapshot reflects (ADR 0004 §3.1/§3.2).
 *
 * `project_changes.sequence_number` is a global identity, and two concurrent
 * inserts can commit out of order (wp-server.md, open issues). A plain
 * "everything ≤ cursor" model could therefore skip a change that became
 * visible late. The position keeps a small window of change ids instead:
 *
 * - every change with `seq ≤ floor` is reflected;
 * - of the changes with `seq > floor`, exactly those listed in `seen` are;
 * - pulls always restart at `floor`, and changes already in `seen` are skipped
 *   (dedup by `change_id`), so a late commit inside the window is picked up;
 * - `cursor` is the highest sequence a pull has completed; after a pull the
 *   window is pruned to `PULL_OVERLAP` sequence numbers below the cursor.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Sequence numbers below the cursor that are re-pulled (and deduped). */
export const PULL_OVERLAP = 200;

// ── Types ────────────────────────────────────────────────────────────────────

/** A reflected change above the floor. */
export interface SeenChange {
  id: string;
  seq: number;
}

/** Serializable sync position (stored next to base and working snapshots). */
export interface SyncPositionData {
  floor: number;
  cursor: number;
  seen: SeenChange[];
}

/** Snapshot as stored in the `ProjectStore`, with sync bookkeeping attached. */
export type StoredSyncSnapshot = ProjectSnapshot & {
  /** Sync position of the snapshot (missing in snapshots of older builds). */
  pmSync?: SyncPositionData & {
    /** Highest outbox `order` reflected (working snapshot only). */
    outboxOrder?: number;
  };
};

// ── Position ─────────────────────────────────────────────────────────────────

/** Mutable sync position with dedup by change id. */
export class SyncPosition {
  floor: number;
  cursor: number;
  private readonly seen = new Map<string, number>();

  constructor(data: SyncPositionData) {
    this.floor = data.floor;
    this.cursor = Math.max(data.cursor, data.floor);
    for (const s of data.seen) if (s.seq > data.floor) this.seen.set(s.id, s.seq);
  }

  /** Position at `seq` with nothing seen above it (e.g. a server snapshot). */
  static at(seq: number): SyncPosition {
    return new SyncPosition({ floor: seq, cursor: seq, seen: [] });
  }

  /** True when the change is reflected (seen, or at/below the floor). */
  reflects(id: string, seq: number): boolean {
    return seq <= this.floor || this.seen.has(id);
  }

  /** True when the change id is in the seen window (sequence unknown). */
  hasId(id: string): boolean {
    return this.seen.has(id);
  }

  /** Record a reflected change. */
  add(id: string, seq: number): void {
    if (!id || seq <= this.floor) return;
    this.seen.set(id, seq);
  }

  /** Sequence a pull has to start after (exclusive). */
  pullFrom(): number {
    return this.floor;
  }

  /**
   * A pull completed up to `seq`: move the cursor and prune the window to
   * `PULL_OVERLAP` sequence numbers below it.
   */
  advance(seq: number): void {
    if (seq > this.cursor) this.cursor = seq;
    const nextFloor = this.cursor - PULL_OVERLAP;
    if (nextFloor <= this.floor) return;
    this.floor = nextFloor;
    for (const [id, s] of this.seen) if (s <= nextFloor) this.seen.delete(id);
  }

  /** Highest reflected sequence number (for server snapshots). */
  highest(): number {
    let max = this.cursor;
    for (const s of this.seen.values()) if (s > max) max = s;
    return max;
  }

  /** Independent copy. */
  clone(): SyncPosition {
    return new SyncPosition(this.toData());
  }

  /** Plain data for storage. */
  toData(): SyncPositionData {
    return {
      floor: this.floor,
      cursor: this.cursor,
      seen: [...this.seen].map(([id, seq]) => ({ id, seq })),
    };
  }
}

// ── Packing ──────────────────────────────────────────────────────────────────

/** Attach the sync position (and outbox order) to a snapshot for storage. */
export function packSnapshot(snapshot: ProjectSnapshot, position: SyncPosition | null, outboxOrder?: number): StoredSyncSnapshot {
  const out: StoredSyncSnapshot = { ...snapshot };
  if (position) out.pmSync = { ...position.toData(), ...(outboxOrder != null ? { outboxOrder } : {}) };
  else if (outboxOrder != null) out.pmSync = { floor: 0, cursor: 0, seen: [], outboxOrder };
  return out;
}

/** Split a stored snapshot into plain snapshot + position (fallback: `cursor`). */
export function unpackSnapshot(stored: StoredSyncSnapshot, fallbackCursor: number): {
  snapshot: ProjectSnapshot;
  position: SyncPosition;
  outboxOrder: number;
} {
  const { pmSync, ...snapshot } = stored;
  return {
    snapshot: snapshot as ProjectSnapshot,
    position: pmSync ? new SyncPosition(pmSync) : SyncPosition.at(fallbackCursor),
    outboxOrder: pmSync?.outboxOrder ?? 0,
  };
}
