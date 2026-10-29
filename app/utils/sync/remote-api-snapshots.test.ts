// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { listSnapshots, parseListResponse } from '~/utils/sync/remote-api-snapshots';

// ── Mock client ──────────────────────────────────────────────────────────────

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
const entry = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `s-${seq}`,
  sequenceNumber: seq,
  label: null,
  createdAt: '2026-10-18T10:00:00.123456+00:00',
  createdBy: 'u1',
  authorName: 'Ada',
  summary: { fixtures: 4, groups: 1, modifiers: 2 },
  ...over,
});

beforeEach(() => reportNetworkSuccess());

// ── listSnapshots ────────────────────────────────────────────────────────────

describe('listSnapshots', () => {
  it('sends projectId, cursor and limit and maps the page', async () => {
    const { client, invoke } = mockClient({ data: { snapshots: [entry(9), entry(8, { label: 'Uploaded' })], nextCursor: 'c1' }, error: null });
    const res = await listSnapshots(client, { projectId: PID, before: 'c0', limit: 2 });

    expect(invoke).toHaveBeenCalledWith('list-snapshots', { body: { projectId: PID, before: 'c0', limit: 2 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nextCursor).toBe('c1');
    expect(res.data.snapshots.map(s => s.sequenceNumber)).toEqual([9, 8]);
    expect(res.data.snapshots[1]).toMatchObject({ label: 'Uploaded', authorName: 'Ada', summary: { fixtures: 4, groups: 1, modifiers: 2 } });
  });

  it('omits an empty cursor and the limit when not given', async () => {
    const { client, invoke } = mockClient({ data: { snapshots: [], nextCursor: null }, error: null });
    await listSnapshots(client, { projectId: PID, before: null });
    expect(invoke).toHaveBeenCalledWith('list-snapshots', { body: { projectId: PID } });
  });

  it('classifies HTTP errors', async () => {
    const { client } = mockClient({ data: null, error: httpError(403, { error: 'Forbidden' }) });
    const res = await listSnapshots(client, { projectId: PID });
    expect(res).toMatchObject({ ok: false, error: { kind: 'forbidden', status: 403, message: 'Forbidden' } });
  });

  it('rejects the old array response (function not redeployed)', async () => {
    const { client } = mockClient({ data: [{ id: 'x', sequence_number: 1 }], error: null });
    const res = await listSnapshots(client, { projectId: PID });
    expect(res).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  });
});

// ── parseListResponse ────────────────────────────────────────────────────────

describe('parseListResponse', () => {
  it('defaults missing optional fields', () => {
    const res = parseListResponse({ snapshots: [{ id: 'a', sequenceNumber: '3', createdAt: '2026-10-18T10:00:00Z' }] });
    expect(res).toEqual({
      snapshots: [{
        id: 'a', sequenceNumber: 3, label: null, createdAt: '2026-10-18T10:00:00Z', createdBy: null, authorName: null,
        summary: { fixtures: 0, groups: 0, modifiers: 0 },
      }],
      nextCursor: null,
    });
  });

  it('rejects entries without id or time', () => {
    expect(parseListResponse({ snapshots: [{ sequenceNumber: 1, createdAt: 'x' }] })).toBeNull();
    expect(parseListResponse({ snapshots: [{ id: 'a', sequenceNumber: 1 }] })).toBeNull();
    expect(parseListResponse(null)).toBeNull();
  });
});
