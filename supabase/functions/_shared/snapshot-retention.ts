// ── Snapshot retention (migration 013) ─────────────────────────────────────
//
// After every stored snapshot, save-snapshot asks the database to thin the
// project's snapshots (`prune_project_snapshots`, see
// supabase/migrations/013_snapshot_retention.sql for the policy). Pruning is
// best effort: it must never fail or delay a save.
//
// No Deno/Supabase imports, so the helper is testable with `bun test`.

/** Name of the per-project prune RPC (returns the number of deleted rows). */
export const PRUNE_SNAPSHOTS_RPC = 'prune_project_snapshots';

/** The part of a Supabase client this helper needs. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/** Logger for failures (defaults to console.warn). */
export type WarnFn = (message: string, detail?: unknown) => void;

/**
 * Prunes the snapshots of one project. Never throws.
 * Returns the number of deleted snapshots, or `null` when the call failed
 * (the failure is logged). `0` also means "another writer held the project
 * lock" — the next save prunes.
 */
export async function pruneSnapshotsBestEffort(
  client: RpcClient,
  projectId: string,
  warn: WarnFn = (message, detail) => console.warn(message, detail),
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc(PRUNE_SNAPSHOTS_RPC, { p_project_id: projectId });
    if (error) {
      warn(`[save-snapshot] prune failed for ${projectId}: ${error.message}`);
      return null;
    }
    return typeof data === 'number' ? data : Number(data ?? 0) || 0;
  } catch (err) {
    warn(`[save-snapshot] prune failed for ${projectId}`, err);
    return null;
  }
}

/**
 * Runs `task` after the response when the runtime supports it
 * (`EdgeRuntime.waitUntil` on Supabase), otherwise awaits it inline.
 * `task` must not throw (use pruneSnapshotsBestEffort).
 */
export async function runAfterResponse(
  task: Promise<unknown>,
  waitUntil: ((p: Promise<unknown>) => unknown) | undefined,
): Promise<void> {
  if (waitUntil) {
    waitUntil(task);
    return;
  }
  await task;
}

/**
 * `EdgeRuntime.waitUntil` of the Supabase edge runtime, or `undefined`
 * elsewhere (tests, `deno run`). Read from globalThis because the global is
 * not declared by every version of the edge-runtime typings.
 */
export function edgeWaitUntil(): ((p: Promise<unknown>) => unknown) | undefined {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => unknown } }).EdgeRuntime;
  const waitUntil = runtime?.waitUntil;
  return typeof waitUntil === 'function' ? (p) => waitUntil.call(runtime, p) : undefined;
}
