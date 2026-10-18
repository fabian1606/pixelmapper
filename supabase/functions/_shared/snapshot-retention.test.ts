// Run with: bun test supabase/functions/_shared
// Best-effort snapshot pruning after save-snapshot (migration 013).
import { describe, expect, test } from 'bun:test';
import {
  edgeWaitUntil,
  PRUNE_SNAPSHOTS_RPC,
  pruneSnapshotsBestEffort,
  type RpcClient,
  runAfterResponse,
} from './snapshot-retention.ts';

const PROJECT = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';

/** Client whose rpc() resolves to `result` (or throws `throws`). */
function client(result: { data: unknown; error: { message: string } | null }, throws?: unknown) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const c: RpcClient = {
    rpc(fn, args) {
      calls.push([fn, args]);
      if (throws) return Promise.reject(throws);
      return Promise.resolve(result);
    },
  };
  return { c, calls };
}

describe('pruneSnapshotsBestEffort', () => {
  test('calls the prune RPC with the project id and returns the count', async () => {
    const { c, calls } = client({ data: 12, error: null });
    expect(await pruneSnapshotsBestEffort(c, PROJECT, () => {})).toBe(12);
    expect(calls).toEqual([[PRUNE_SNAPSHOTS_RPC, { p_project_id: PROJECT }]]);
  });

  test('an RPC error is logged and yields null', async () => {
    const { c } = client({ data: null, error: { message: 'forbidden' } });
    const logged: string[] = [];
    expect(await pruneSnapshotsBestEffort(c, PROJECT, (m) => logged.push(m))).toBeNull();
    expect(logged[0]).toContain('forbidden');
  });

  test('a thrown error (network) is logged and yields null', async () => {
    const { c } = client({ data: null, error: null }, new TypeError('fetch failed'));
    const logged: unknown[] = [];
    expect(await pruneSnapshotsBestEffort(c, PROJECT, (_m, d) => logged.push(d))).toBeNull();
    expect(logged[0]).toBeInstanceOf(TypeError);
  });

  test('a missing or string count is normalised', async () => {
    expect(await pruneSnapshotsBestEffort(client({ data: null, error: null }).c, PROJECT, () => {})).toBe(0);
    expect(await pruneSnapshotsBestEffort(client({ data: '3', error: null }).c, PROJECT, () => {})).toBe(3);
  });
});

describe('runAfterResponse', () => {
  test('hands the task to waitUntil when available', async () => {
    const handed: Promise<unknown>[] = [];
    let done = false;
    const task = new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 5));
    await runAfterResponse(task, (p) => handed.push(p));
    expect(handed).toEqual([task]);
    expect(done).toBe(false);
    await task;
  });

  test('awaits the task without waitUntil', async () => {
    let done = false;
    const task = new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 5));
    await runAfterResponse(task, undefined);
    expect(done).toBe(true);
  });
});

describe('edgeWaitUntil', () => {
  test('undefined outside the edge runtime', () => {
    expect(edgeWaitUntil()).toBeUndefined();
  });

  test('binds EdgeRuntime.waitUntil when present', () => {
    const handed: Promise<unknown>[] = [];
    const g = globalThis as { EdgeRuntime?: unknown };
    g.EdgeRuntime = { waitUntil(this: { tag: string }, p: Promise<unknown>) { if (this.tag === 'rt') handed.push(p); }, tag: 'rt' };
    try {
      const p = Promise.resolve();
      edgeWaitUntil()?.(p);
      expect(handed).toEqual([p]);
    } finally {
      delete g.EdgeRuntime;
    }
  });
});
