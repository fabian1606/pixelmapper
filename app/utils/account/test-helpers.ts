import { vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import type { RemoteProjectHead } from '~/utils/sync/remote-api-types';

/**
 * Shared fixtures for the account tests (test-only module, not a test file).
 */

// ── Remote client ────────────────────────────────────────────────────────────

/** Outcome of one `functions.invoke` call, as supabase-js returns it. */
export type InvokeResult = { data: unknown; error: unknown };

/** Handler per edge function; unhandled functions answer 404. */
export type InvokeHandler = (name: string, body: Record<string, unknown>) => InvokeResult | Promise<InvokeResult>;

/** Mock `RemoteClient` whose invoke is routed through `handler`. */
export function mockClient(handler: InvokeHandler) {
  const invoke = vi.fn(async (name: string, options?: { body?: Record<string, unknown> }) =>
    handler(name, options?.body ?? {}));
  const client: RemoteClient = { functions: { invoke } };
  return { client, invoke };
}

/** Mimics supabase-js `FunctionsHttpError` (Response in `context`). */
export function httpError(status: number, message = 'error') {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  err.name = 'FunctionsHttpError';
  err.context = new Response(JSON.stringify({ error: message }), { status });
  return err;
}

/** Mimics supabase-js `FunctionsFetchError` (no response). */
export function fetchError() {
  const err = new Error('Failed to send a request to the Edge Function');
  err.name = 'FunctionsFetchError';
  return err;
}

// ── Data ─────────────────────────────────────────────────────────────────────

/** Minimal valid snapshot; `tag` makes snapshots distinguishable. */
export function snapshot(tag = 'a'): ProjectSnapshot {
  return {
    schemaVersion: 3,
    sceneNodes: [],
    savedPresets: [],
    pinnedModifiers: [],
    globalBases: { tag },
    modifiers: [],
  } as unknown as ProjectSnapshot;
}

/** Project meta with defaults (local-only, created at t=1000). */
export function meta(id: string, over: Partial<LocalProjectMeta> = {}): LocalProjectMeta {
  return {
    id,
    name: `Project ${id}`,
    origin: 'local',
    ownerUserId: null,
    serverCursor: 0,
    createdAt: 1000,
    updatedAt: 1000,
    lastSyncedAt: null,
    ...over,
  };
}

/** Cloud copy bound to `userId`. */
export function cloudMeta(id: string, userId: string, over: Partial<LocalProjectMeta> = {}): LocalProjectMeta {
  return meta(id, { origin: 'cloud', ownerUserId: userId, role: 'owner', lastSyncedAt: 1000, ...over });
}

/** Remote project head with defaults. */
export function head(id: string, over: Partial<RemoteProjectHead> = {}): RemoteProjectHead {
  return {
    id,
    name: `Project ${id}`,
    description: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    role: 'owner',
    ownerId: 'u1',
    latestSequence: 0,
    latestChangeAt: null,
    latestSnapshotSequence: 0,
    ...over,
  };
}

/** Head as the `list-projects-sync` edge function returns it (snake_case row). */
export function headRow(h: RemoteProjectHead): Record<string, unknown> {
  return {
    id: h.id,
    name: h.name,
    description: h.description,
    created_at: h.createdAt,
    updated_at: h.updatedAt,
    role: h.role,
    owner_id: h.ownerId,
    latest_sequence: h.latestSequence,
    latest_change_at: h.latestChangeAt,
    latest_snapshot_sequence: h.latestSnapshotSequence,
  };
}

// ── Sync service ─────────────────────────────────────────────────────────────

/** Fake `ProjectSyncService` with spy methods. */
export function fakeSync(over: Partial<ProjectSyncService> = {}) {
  return {
    mirrorProject: vi.fn(async (_head: RemoteProjectHead, _userId: string) => true),
    flushAll: vi.fn(async (_userId: string) => 0),
    countPending: vi.fn(async (_projectId?: string) => 0),
    ...over,
  } satisfies ProjectSyncService;
}

/** Appends one outbox command for `projectId`. */
export function outboxEntry(projectId: string, id = `c-${projectId}-${Math.random()}`) {
  return { id, projectId, kind: 'command' as const, type: 'SetModifiers', payload: {}, enqueuedAt: 1 };
}
