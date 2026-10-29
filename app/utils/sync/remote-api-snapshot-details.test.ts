// @vitest-environment node
/**
 * `snapshot-details` wrapper: request body, response parsing, errors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { getSnapshotDetails, parseSnapshotDetailsResponse } from '~/utils/sync/remote-api-snapshot-details';

type InvokeResult = { data: unknown; error: unknown };

/** Mock client whose `invoke` resolves with `outcome`. */
function mockClient(outcome: InvokeResult) {
  const invoke = vi.fn(async (_name: string, _options?: { body?: Record<string, unknown> }) => outcome);
  const client: RemoteClient = { functions: { invoke } };
  return { client, invoke };
}

/** Mimics supabase-js `FunctionsHttpError`. */
function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  err.context = new Response(JSON.stringify(body), { status });
  return err;
}

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const snap = (id: string, seq: number | string) => ({ id, sequenceNumber: seq, label: null, createdAt: '2026-10-18T10:00:00Z', data: { sceneNodes: [] } });
const body = {
  snapshot: snap('s9', 9),
  previous: snap('s4', '4'),
  activity: [{ userId: 'u1', authorName: 'Ada', commandType: 'MoveFixture', count: 3 }, { commandType: 'x', count: 0 }],
  restores: [{ sequenceNumber: 7, createdAt: null, userId: 'u2', authorName: '', snapshotId: 's1', sourceSequence: '2', sourceCreatedAt: null, sourceLabel: null }],
  restoredFrom: null,
};

beforeEach(() => reportNetworkSuccess());

describe('getSnapshotDetails', () => {
  it('sends ids and maps the response', async () => {
    const { client, invoke } = mockClient({ data: body, error: null });
    const res = await getSnapshotDetails(client, { projectId: PID, snapshotId: 's9', compareToId: 's4' });
    expect(invoke).toHaveBeenCalledWith('snapshot-details', { body: { projectId: PID, snapshotId: 's9', compareToId: 's4' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.previous?.sequenceNumber).toBe(4);
    expect(res.data.activity).toEqual([{ userId: 'u1', authorName: 'Ada', commandType: 'MoveFixture', count: 3 }]);
    expect(res.data.restores[0]).toMatchObject({ sequenceNumber: 7, authorName: null, sourceSequence: 2 });
  });

  it('omits a missing compareToId', async () => {
    const { client, invoke } = mockClient({ data: body, error: null });
    await getSnapshotDetails(client, { projectId: PID, snapshotId: 's9', compareToId: null });
    expect(invoke).toHaveBeenCalledWith('snapshot-details', { body: { projectId: PID, snapshotId: 's9' } });
  });

  it('classifies HTTP and network errors', async () => {
    const notFound = await getSnapshotDetails(mockClient({ data: null, error: httpError(404, { error: 'Snapshot not found' }) }).client, { projectId: PID, snapshotId: 's' });
    expect(notFound.ok ? null : notFound.error.kind).toBe('not-found');
    const offline = await getSnapshotDetails(mockClient({ data: null, error: new TypeError('Failed to fetch') }).client, { projectId: PID, snapshotId: 's' });
    expect(offline.ok ? null : offline.error.kind).toBe('network');
  });

  it('rejects an unexpected body as invalid-response', async () => {
    const res = await getSnapshotDetails(mockClient({ data: { snapshot: { id: 1 } }, error: null }).client, { projectId: PID, snapshotId: 's' });
    expect(res.ok ? null : res.error.kind).toBe('invalid-response');
  });
});

describe('parseSnapshotDetailsResponse', () => {
  it('first version: previous null, missing arrays default to empty', () => {
    expect(parseSnapshotDetailsResponse({ snapshot: snap('s1', 1), previous: null })).toEqual({
      snapshot: { ...snap('s1', 1) }, previous: null, activity: [], restores: [], restoredFrom: null,
    });
  });
  it('invalid previous → null', () => {
    expect(parseSnapshotDetailsResponse({ snapshot: snap('s1', 1), previous: { id: 'x' } })).toBeNull();
  });
});
