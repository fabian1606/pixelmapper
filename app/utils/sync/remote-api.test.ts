// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOnline, reportNetworkSuccess } from '~/utils/sync/connectivity';
import {
  createProject,
  listProjectsForSync,
  loadProject,
  pullChanges,
  pushChanges,
  saveSnapshot,
  type RemoteClient,
} from '~/utils/sync/remote-api';
import type { ProjectSnapshot } from '~/utils/engine/serialize';

// ── Mock client ──────────────────────────────────────────────────────────────

type InvokeResult = { data: unknown; error: unknown };

/** Mock client whose `invoke` returns (or throws) the given outcome. */
function mockClient(outcome: InvokeResult | (() => never)) {
  const invoke = vi.fn(async (_name: string, _options?: { body?: Record<string, unknown> }) => {
    if (typeof outcome === 'function') outcome();
    return outcome as InvokeResult;
  });
  const client: RemoteClient = { functions: { invoke } };
  return { client, invoke };
}

/** Mimics supabase-js `FunctionsHttpError` (Response in `context`). */
function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  err.name = 'FunctionsHttpError';
  err.context = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  return err;
}

/** Mimics supabase-js `FunctionsFetchError`. */
function fetchError() {
  const err = new Error('Failed to send a request to the Edge Function') as Error & { context: unknown };
  err.name = 'FunctionsFetchError';
  err.context = new TypeError('Failed to fetch');
  return err;
}

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const CID = 'a1b2c3d4-0000-4000-8000-000000000001';

const changeRow = (seq: number) => ({
  sequence_number: seq,
  change_id: `c-${seq}`,
  user_id: 'u1',
  command_type: 'SetModifiers',
  payload: { n: seq },
  created_at: '2026-10-18T10:00:00Z',
});

beforeEach(() => reportNetworkSuccess());

// ── Error classification ─────────────────────────────────────────────────────

describe('error classification', () => {
  it('network failure → kind network, retryable, reports offline', async () => {
    const { client } = mockClient({ data: null, error: fetchError() });
    const res = await pullChanges(client, { projectId: PID, afterSequence: 0 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: 'network', status: null, retryable: true });
    expect(isOnline.value).toBe(false);
  });

  it('a thrown TypeError is a network failure', async () => {
    const { client } = mockClient(() => { throw new TypeError('Failed to fetch'); });
    const res = await loadProject(client, PID);
    expect(!res.ok && res.error.kind).toBe('network');
  });

  it.each([
    [401, 'auth', false],
    [403, 'forbidden', false],
    [404, 'not-found', false],
    [409, 'conflict', false],
    [400, 'bad-request', false],
    [500, 'server', true],
    [503, 'server', true],
  ] as const)('HTTP %i → %s', async (status, kind, retryable) => {
    const { client } = mockClient({ data: null, error: httpError(status, { error: `boom ${status}` }) });
    const res = await saveSnapshot(client, { projectId: PID, snapshot: {} as ProjectSnapshot, sequenceNumber: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind, status, retryable, message: `boom ${status}` });
    // The backend answered, so it is reachable.
    expect(isOnline.value).toBe(true);
  });

  it('plain-text error bodies become the message', async () => {
    const { client } = mockClient({ data: null, error: httpError(401, 'Unauthorized') });
    const res = await listProjectsForSync(client);
    expect(!res.ok && res.error.message).toBe('Unauthorized');
  });

  it('unexpected 2xx body → invalid-response', async () => {
    const { client } = mockClient({ data: 'Not Found', error: null });
    const res = await pullChanges(client, { projectId: PID, afterSequence: 0 });
    expect(!res.ok && res.error.kind).toBe('invalid-response');
  });
});

// ── Functions ────────────────────────────────────────────────────────────────

describe('pullChanges', () => {
  it('sends the cursor and maps rows to camelCase', async () => {
    const { client, invoke } = mockClient({
      data: { changes: [changeRow(5), changeRow(7)], hasMore: true, nextAfterSequence: 7, latestSequence: 40, snapshotSequence: 20 },
      error: null,
    });
    const res = await pullChanges(client, { projectId: PID, afterSequence: 4, limit: 2 });
    expect(invoke).toHaveBeenCalledWith('pull-changes', { body: { projectId: PID, afterSequence: 4, limit: 2 } });
    expect(res).toEqual({
      ok: true,
      data: {
        changes: [
          { sequenceNumber: 5, changeId: 'c-5', userId: 'u1', commandType: 'SetModifiers', payload: { n: 5 }, createdAt: '2026-10-18T10:00:00Z' },
          { sequenceNumber: 7, changeId: 'c-7', userId: 'u1', commandType: 'SetModifiers', payload: { n: 7 }, createdAt: '2026-10-18T10:00:00Z' },
        ],
        hasMore: true,
        nextAfterSequence: 7,
        latestSequence: 40,
        snapshotSequence: 20,
      },
    });
  });
});

describe('pushChanges', () => {
  it('returns acks in request order; unconfirmed changes have no sequence number', async () => {
    const other = 'a1b2c3d4-0000-4000-8000-000000000002';
    const { client, invoke } = mockClient({
      data: { sequenceNumbers: [11, null], sequenceNumber: 11, changeIds: [CID, null] },
      error: null,
    });
    const res = await pushChanges(client, PID, [
      { changeId: CID, commandType: 'A', payload: 1 },
      { changeId: other, commandType: 'B', payload: 2 },
    ]);
    expect(invoke.mock.calls[0]![1]).toEqual({
      body: { projectId: PID, changes: [{ changeId: CID, commandType: 'A', payload: 1 }, { changeId: other, commandType: 'B', payload: 2 }] },
    });
    expect(res).toEqual({ ok: true, data: [{ changeId: CID, sequenceNumber: 11 }, { changeId: other, sequenceNumber: null }] });
  });
});

describe('createProject', () => {
  it('passes the client id + snapshot and reports idempotent returns', async () => {
    const { client, invoke } = mockClient({
      data: { id: PID, name: 'Show', description: null, created_at: 'c', updated_at: 'u', created: false, snapshot: null },
      error: null,
    });
    const snapshot = { version: 2 } as unknown as ProjectSnapshot;
    const res = await createProject(client, { id: PID, name: 'Show', snapshot });
    expect(invoke).toHaveBeenCalledWith('create-project', { body: { id: PID, name: 'Show', snapshot } });
    expect(res).toEqual({
      ok: true,
      data: { project: { id: PID, name: 'Show', description: null, createdAt: 'c', updatedAt: 'u' }, created: false, snapshot: null },
    });
  });

  it('treats responses of old deployments (no `created`) as created', async () => {
    const { client } = mockClient({ data: { id: PID, name: 'Show' }, error: null });
    const res = await createProject(client, { name: 'Show' });
    expect(res.ok && res.data.created).toBe(true);
  });

  it('409 (id owned by someone else) → conflict', async () => {
    const { client } = mockClient({ data: null, error: httpError(409, { error: 'project id already in use' }) });
    const res = await createProject(client, { id: PID, name: 'Show' });
    expect(!res.ok && res.error.kind).toBe('conflict');
  });
});

describe('listProjectsForSync', () => {
  it('maps heads', async () => {
    const { client, invoke } = mockClient({
      data: {
        projects: [{
          id: PID, name: 'Show', description: 'd', created_at: 'c', updated_at: 'u',
          role: 'editor', owner_id: 'owner-1', latest_sequence: 99, latest_change_at: 't', latest_snapshot_sequence: 80,
        }],
      },
      error: null,
    });
    const res = await listProjectsForSync(client);
    expect(invoke).toHaveBeenCalledWith('list-projects-sync', { body: {} });
    expect(res).toEqual({
      ok: true,
      data: [{
        id: PID, name: 'Show', description: 'd', createdAt: 'c', updatedAt: 'u',
        role: 'editor', ownerId: 'owner-1', latestSequence: 99, latestChangeAt: 't', latestSnapshotSequence: 80,
      }],
    });
  });
});

describe('saveSnapshot', () => {
  it('sends the label and maps the meta', async () => {
    const { client, invoke } = mockClient({
      data: { id: 's1', sequence_number: 12, label: 'before offline sync', created_at: 'c' },
      error: null,
    });
    const snapshot = {} as ProjectSnapshot;
    const res = await saveSnapshot(client, { projectId: PID, snapshot, sequenceNumber: 12, label: 'before offline sync' });
    expect(invoke).toHaveBeenCalledWith('save-snapshot', {
      body: { projectId: PID, snapshot, sequenceNumber: 12, label: 'before offline sync' },
    });
    expect(res).toEqual({ ok: true, data: { id: 's1', sequenceNumber: 12, label: 'before offline sync', createdAt: 'c' } });
  });
});

describe('loadProject', () => {
  it('maps the tail including user and change ids', async () => {
    const { client } = mockClient({
      data: { snapshot: { version: 2 }, snapshotSequence: 4, tail: [changeRow(5)], latestSequence: 5 },
      error: null,
    });
    const res = await loadProject(client, PID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tail[0]).toMatchObject({ sequenceNumber: 5, changeId: 'c-5', userId: 'u1' });
    expect(res.data.tailTruncated).toBe(false);
  });

  it('flags a tail cut off by the server row cap', async () => {
    const { client } = mockClient({
      data: { snapshot: null, snapshotSequence: 0, tail: [changeRow(5)], latestSequence: 2000 },
      error: null,
    });
    const res = await loadProject(client, PID);
    expect(res.ok && res.data.tailTruncated).toBe(true);
  });

  it('works with old deployments without latestSequence', async () => {
    const { client } = mockClient({ data: { snapshot: null, snapshotSequence: 0, tail: [] }, error: null });
    const res = await loadProject(client, PID);
    expect(res).toEqual({
      ok: true,
      data: { snapshot: null, snapshotSequence: 0, tail: [], latestSequence: 0, tailTruncated: false },
    });
  });
});
