// ── Which snapshot a project is loaded from ─────────────────────────────────
//
// Pure constants (no Deno/Supabase imports), shared by load-project,
// pull-changes and load-shared-project.

/**
 * Label of the D5 safety snapshot the client saves before pushing rebased
 * offline changes (`BEFORE_SYNC_LABEL` in app/utils/sync/sync-push.ts).
 */
export const SAFETY_SNAPSHOT_LABEL = 'before offline sync';

/**
 * PostgREST `or` filter for snapshots a project may be LOADED from: every
 * snapshot except the safety snapshots.
 *
 * A safety snapshot is a restore point computed by one client (old base +
 * the remote changes it pulled). It equals the server state at its position
 * in the normal case, so skipping it only makes the replayed tail longer.
 * But a client that rebased across a `restore-snapshot` marker computes it
 * WITHOUT the restore (it cannot replay the marker), at a position at or
 * after the marker; as the newest snapshot it would silently undo the
 * restore for everyone loading the project. Restoring a safety snapshot
 * copies it under another label, so that copy is used.
 */
export const LOADABLE_SNAPSHOT_FILTER = `label.is.null,label.neq."${SAFETY_SNAPSHOT_LABEL}"`;
