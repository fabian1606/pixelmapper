// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { fetchRemoteHeads } from './remote-heads';
import { fetchError, head, headRow, httpError, mockClient } from './test-helpers';

/** A legacy `get-projects` row. */
const legacyRow = { id: 'p1', name: 'Show', description: 'd', created_at: 'c', updated_at: 'u', role: 'editor' };

beforeEach(() => reportNetworkSuccess());

// ── fetchRemoteHeads ─────────────────────────────────────────────────────────

describe('fetchRemoteHeads', () => {
  it('uses list-projects-sync when available', async () => {
    const h = head('p1', { latestSequence: 9 });
    const { client, invoke } = mockClient(() => ({ data: { projects: [headRow(h)] }, error: null }));
    const res = await fetchRemoteHeads(client);
    expect(res).toEqual({ ok: true, data: [h] });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not deployed (404)', { data: null, error: httpError(404, 'Function not found') }],
    ['unexpected body', { data: { nope: true }, error: null }],
  ])('falls back to get-projects when %s', async (_label, syncOutcome) => {
    const { client, invoke } = mockClient(name =>
      name === 'list-projects-sync' ? syncOutcome : { data: [legacyRow, { id: 'p2' }], error: null });
    const res = await fetchRemoteHeads(client);
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['list-projects-sync', 'get-projects']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toMatchObject({ id: 'p1', name: 'Show', description: 'd', role: 'editor', latestSequence: 0, ownerId: null });
    expect(res.data[1]).toMatchObject({ id: 'p2', name: '', role: 'viewer', latestSequence: 0 });
  });

  it('does not fall back on a network error', async () => {
    const { client, invoke } = mockClient(() => ({ data: null, error: fetchError() }));
    const res = await fetchRemoteHeads(client);
    expect(!res.ok && res.error.kind).toBe('network');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on auth errors', async () => {
    const { client, invoke } = mockClient(() => ({ data: null, error: httpError(401, 'expired') }));
    expect((await fetchRemoteHeads(client)).ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports an invalid legacy body as invalid-response', async () => {
    const { client } = mockClient(name =>
      name === 'list-projects-sync' ? { data: {}, error: null } : { data: [{ name: 'no id' }], error: null });
    const res = await fetchRemoteHeads(client);
    expect(!res.ok && res.error.kind).toBe('invalid-response');
  });
});
