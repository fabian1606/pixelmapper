// ── create-project: what to do when the client id already exists ────────────
//
// Pure decision logic (no Deno/Supabase imports), unit-tested with
// `bun test supabase/functions/_shared`. The edge function gathers the facts
// and executes the returned plan.

/**
 * A project younger than this without an owner row is most likely still
 * being created by a concurrent request (insert project → insert owner →
 * insert snapshot). Older ones are orphans of a failed rollback.
 */
export const ORPHAN_AGE_MS = 60_000;

/** Facts about the existing project with the requested id. */
export interface ExistingProjectFacts {
  callerId: string;
  /** user ids of the `owner` collaborator rows (0 or 1). */
  ownerIds: string[];
  /** Number of collaborator rows of any role. */
  collaboratorCount: number;
  /** `projects.created_by` (null for projects created before migration 009). */
  createdBy: string | null;
  /** Age of the project row (now − created_at), ms. */
  ageMs: number;
  /** The request carries an initial snapshot. */
  snapshotSupplied: boolean;
  /** Highest change sequence of the project (0 = no changes yet). */
  headSequence: number;
}

/** What the function answers. */
export type ExistingProjectPlan =
  /** Caller owns it (or adopts it): return it, optionally storing the snapshot. */
  | { kind: 'owned'; adopt: boolean; storeSnapshot: boolean }
  /** 409, not retryable. */
  | { kind: 'conflict'; error: string }
  /** 503, retry shortly (concurrent create in flight). */
  | { kind: 'retry'; error: string };

/** Error text of the retryable answer (the client maps 503 → retry). */
export const PROJECT_BEING_CREATED = 'project is being created, retry';

/**
 * Decide how to answer a create with an id that exists already.
 *
 * - Owned by the caller: idempotent success. A supplied snapshot is stored
 *   again (as a NEW seq-0 snapshot; the newest one wins) while the project
 *   has no changes, so a retry after a lost response uploads the CURRENT
 *   local state instead of silently keeping the first attempt's state. Once
 *   changes exist the local copy cannot be bound to it any more → 409.
 * - Owned by someone else → 409.
 * - No owner row yet:
 *   - young project → 503 (a concurrent create is still running; retry);
 *   - older orphan created by the caller → adopt it (insert owner row);
 *   - older orphan of someone else / unknown creator (pre-009 row) → 409:
 *     ownership cannot be proven, so it is never handed out.
 */
export function planExistingProject(f: ExistingProjectFacts): ExistingProjectPlan {
  const owner = f.ownerIds[0];
  if (owner !== undefined) {
    if (owner !== f.callerId) return { kind: 'conflict', error: 'project id already in use' };
    return ownedPlan(f, false);
  }
  if (f.collaboratorCount > 0) return { kind: 'conflict', error: 'project id already in use' };
  if (f.ageMs < ORPHAN_AGE_MS) return { kind: 'retry', error: PROJECT_BEING_CREATED };
  if (f.createdBy === f.callerId) return ownedPlan(f, true);
  return { kind: 'conflict', error: 'project id already in use' };
}

/** Plan for a project the caller owns (or adopts). */
function ownedPlan(f: ExistingProjectFacts, adopt: boolean): ExistingProjectPlan {
  if (!f.snapshotSupplied) return { kind: 'owned', adopt, storeSnapshot: false };
  if (f.headSequence > 0) {
    return { kind: 'conflict', error: 'project already has changes on the server; open it from the cloud instead' };
  }
  return { kind: 'owned', adopt, storeSnapshot: true };
}
