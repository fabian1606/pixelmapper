// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { createProject, pushChanges, saveSnapshot, type RemoteClient } from '~/utils/sync/remote-api';
import { restoreSnapshot } from '~/utils/sync/remote-api-restore';
import type { ProjectSnapshot } from '~/utils/engine/serialize';

/**
 * Wrapper behaviour for the server fixes of migration 009 (push RPC,
 * restore marker, create-project 503, save-snapshot bounds).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const C1 = 'a1b2c3d4-0000-4000-8000-000000000001';
const C2 = 'a1b2c3d4-0000-4000-8000-000000000002';

/** Client whose `invoke` returns `outcome`. */
function mockClient(outcome: { data: unknown; error: unknown }) {
  const invoke = vi.fn(async () => outcome);
  const client: RemoteClient = { functions: { invoke } };
  return { client, invoke };
}

/** supabase-js `FunctionsHttpError` with a JSON `{ error }` body. */
function httpError(status: number, message: string) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  err.name = 'FunctionsHttpError';
  err.context = new Response(JSON.stringify({ error: message }), { status });
  return err;
}

beforeEach(() => reportNetworkSuccess());

// ── push-change (push_changes RPC) ───────────────────────────────────────────

describe('pushChanges against the RPC-backed push-change', () => {
  it('a retried chunk is acknowledged with the stored numbers', async () => {
    // Same response for the first push and its retry: the RPC returns the
    // stored sequence numbers of the caller's own rows.
    const { client } = mockClient({ data: { sequenceNumbers: [11, 12], sequenceNumber: 11, changeIds: [C1, C2] }, error: null });
    const input = [{ changeId: C1, commandType: 'A', payload: 1 }, { changeId: C2, commandType: 'B', payload: 2 }];
    const first = await pushChanges(client, PID, input);
    const retry = await pushChanges(client, PID, input);
    expect(retry).toEqual(first);
    expect(retry).toEqual({ ok: true, data: [{ changeId: C1, sequenceNumber: 11 }, { changeId: C2, sequenceNumber: 12 }] });
  });

  it("a change id stored by another user is not acknowledged (null) even though the id is echoed", async () => {
    const { client } = mockClient({ data: { sequenceNumbers: [11, null], sequenceNumber: 11, changeIds: [C1, C2] }, error: null });
    const res = await pushChanges(client, PID, [
      { changeId: C1, commandType: 'A', payload: 1 },
      { changeId: C2, commandType: 'B', payload: 2 },
    ]);
    expect(res).toEqual({ ok: true, data: [{ changeId: C1, sequenceNumber: 11 }, { changeId: C2, sequenceNumber: null }] });
  });

  it('a viewer gets 403 → forbidden (not a retryable 500)', async () => {
    const { client } = mockClient({ data: null, error: httpError(403, 'forbidden') });
    const res = await pushChanges(client, PID, [{ changeId: C1, commandType: 'A', payload: 1 }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: 'forbidden', status: 403, retryable: false });
  });
});

// ── restore-snapshot ─────────────────────────────────────────────────────────

describe('restoreSnapshot', () => {
  it('maps the marker sequence of the new response', async () => {
    const { client, invoke } = mockClient({
      data: {
        snapshot: { version: 2 },
        meta: { id: 'snap-9', sequence_number: 42, created_at: 'c' },
        markerChangeId: C1,
        sourceSequence: 30,
      },
      error: null,
    });
    const res = await restoreSnapshot(client, { projectId: PID, snapshotId: 'snap-1' });
    expect(invoke).toHaveBeenCalledWith('restore-snapshot', { body: { projectId: PID, snapshotId: 'snap-1' } });
    expect(res).toEqual({ ok: true, data: { snapshot: { version: 2 }, id: 'snap-9', sequenceNumber: 42 } });
  });

  it('viewer → forbidden, unknown snapshot → not-found, bad id → bad-request', async () => {
    for (const [status, kind] of [[403, 'forbidden'], [404, 'not-found'], [400, 'bad-request']] as const) {
      const { client } = mockClient({ data: null, error: httpError(status, 'x') });
      const res = await restoreSnapshot(client, { projectId: PID, snapshotId: 'snap-1' });
      expect(!res.ok && res.error.kind).toBe(kind);
    }
  });
});

// ── create-project / save-snapshot status codes ──────────────────────────────

describe('status codes', () => {
  it('create-project 503 (create in flight) is a retryable server error', async () => {
    const { client } = mockClient({ data: null, error: httpError(503, 'project is being created, retry') });
    const res = await createProject(client, { id: PID, name: 'Show' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: 'server', status: 503, retryable: true, message: 'project is being created, retry' });
  });

  it('save-snapshot beyond the latest change → bad-request, not retried', async () => {
    const { client } = mockClient({ data: null, error: httpError(400, 'sequenceNumber 99 is beyond the latest change (5)') });
    const res = await saveSnapshot(client, { projectId: PID, snapshot: {} as ProjectSnapshot, sequenceNumber: 99 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: 'bad-request', retryable: false });
  });
});
