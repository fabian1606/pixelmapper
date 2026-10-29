/**
 * Supabase record remote against a mocked client: query shape, accepted
 * ids from the upsert and error mapping for `isNetworkError`.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isNetworkError } from '../connectivity';
import { createSupabaseRecordRemote } from './record-remote';

/** Records every builder call and resolves with `result`. */
function mockClient(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'upsert', 'select', 'in', 'eq', 'or', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  // Awaiting the builder yields the result (PostgREST builders are thenables).
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('createSupabaseRecordRemote', () => {
  it('upserts on id and returns the accepted ids', async () => {
    const { client, calls } = mockClient({ data: [{ id: 'a' }], error: null });
    const ids = await createSupabaseRecordRemote(client).upsert([
      { id: 'a', user_id: 'u', kind: 'k', data: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null },
      { id: 'b', user_id: 'u', kind: 'k', data: {}, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null },
    ]);
    expect(ids).toEqual(['a']);
    expect(calls[0]).toEqual(['from', 'user_records']);
    expect(calls[1]?.[0]).toBe('upsert');
    expect(calls[1]?.[2]).toEqual({ onConflict: 'id' });
  });

  it('pulls with a keyset filter ordered by server time and id', async () => {
    const { client, calls } = mockClient({ data: [], error: null });
    await createSupabaseRecordRemote(client).pullPage('custom-fixture', { ts: '2026-01-01T00:00:00.5+00:00', id: 'x' }, 50);
    expect(calls).toContainEqual(['eq', 'kind', 'custom-fixture']);
    expect(calls).toContainEqual([
      'or',
      'server_updated_at.gt."2026-01-01T00:00:00.5+00:00",and(server_updated_at.eq."2026-01-01T00:00:00.5+00:00",id.gt.x)',
    ]);
    expect(calls).toContainEqual(['order', 'server_updated_at', { ascending: true }]);
    expect(calls).toContainEqual(['limit', 50]);
  });

  it('throws errors that keep network failures recognisable', async () => {
    const { client } = mockClient({ data: null, error: { message: 'TypeError: Failed to fetch' } });
    const err = await createSupabaseRecordRemote(client).fetchByIds(['a']).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(isNetworkError(err)).toBe(true);
  });
});
