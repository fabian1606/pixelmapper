import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store/in-memory-project-store';

type PersistQueue = typeof import('~/utils/persistence/persist-queue');
type OutboxWriter = typeof import('~/utils/persistence/outbox-writer');
type Connectivity = typeof import('~/utils/sync/connectivity');

/** Sent batch as seen by the hook. */
type Sent = Array<{ type: string; payload: any; changeId?: string }>;

let pq: PersistQueue;
let writer: OutboxWriter;
let store: InMemoryProjectStore;
let conn: Connectivity;
let projectId: string;
let counter = 0;

/** Let pending promise chains and IndexedDB callbacks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r));
}

beforeEach(async () => {
  // Fresh module state (queue, timers, connectivity) for every test.
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  conn = await import('~/utils/sync/connectivity');
  writer = await import('~/utils/persistence/outbox-writer');
  pq = await import('~/utils/persistence/persist-queue');
  store = new InMemoryProjectStore();
  writer.setOutboxStoreForTests(store);
  conn.reportNetworkSuccess();
  projectId = `project-${++counter}`;
  pq.setPersistProjectId(projectId);
});

afterEach(() => {
  pq.clearPersistQueue();
  pq.setPersistHook(null);
  pq.setPersistAckHook(null);
  writer.setOutboxStoreForTests(null);
  vi.useRealTimers();
});

/** Pending outbox rows of the current project. */
function outboxRows() {
  return store.getOutbox(projectId);
}

/** Wire a hook that records batches and returns sequence numbers. */
function wireHook(impl?: (batch: Sent) => Promise<Array<number | undefined>>) {
  const sent: Sent[] = [];
  let seq = 0;
  const hook = vi.fn(async (batch: Sent) => {
    sent.push(batch);
    if (impl) return impl(batch);
    return batch.map(() => ++seq);
  });
  pq.setPersistHook(hook);
  // The sync engine acks in production; the tests ack via the hook.
  pq.setPersistAckHook((ids) => { void store.ackOutbox(ids); });
  return { sent, hook };
}

describe('persist queue — outbox (D8)', () => {
  it('writes a live-op to the outbox with a changeId before sending it', async () => {
    let rowsAtSend: string[] = [];
    const { sent } = wireHook(async (batch) => {
      rowsAtSend = (await outboxRows()).map(r => r.id);
      return batch.map((_, i) => i + 1);
    });

    const changeId = pq.enqueueLiveOp('engine.bpm', { bpm: 120 }, 'engine.bpm');
    await pq.flushPersistQueue();

    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ type: 'engine.bpm', changeId });
    expect(rowsAtSend).toEqual([changeId]);
    // Acked → removed from the outbox.
    await settle();
    expect(await outboxRows()).toEqual([]);
  });

  it('coalesces by dedupKey: the superseded changeId is never pushed nor kept in the outbox', async () => {
    const { sent } = wireHook(async () => { throw new TypeError('Failed to fetch'); });

    const first = pq.enqueueLiveOp('engine.bpm', { bpm: 100 }, 'engine.bpm');
    await pq.flushPersistWal(); // first row is already durable…
    const second = pq.enqueueLiveOp('engine.bpm', { bpm: 140 }, 'engine.bpm');
    await pq.flushPersistWal(); // …and gets replaced by the second one

    const rows = await outboxRows();
    expect(rows.map(r => r.id)).toEqual([second]);
    expect(rows[0]).toMatchObject({ kind: 'live-op', dedupKey: 'engine.bpm', payload: { bpm: 140 } });

    await pq.flushPersistQueue();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map(e => e.changeId)).toEqual([second]);
    expect(sent[0]!.map(e => e.changeId)).not.toContain(first);
  });

  it('keeps chronological order; a coalesced op moves to the end', async () => {
    const { sent } = wireHook();
    pq.enqueuePersist({ type: 'CmdA', payload: {}, changeId: 'a' });
    pq.enqueueLiveOp('fixture.drag', { x: 1 }, 'fixture.drag');
    pq.enqueuePersist({ type: 'CmdB', payload: {}, changeId: 'b' });
    pq.enqueueLiveOp('fixture.drag', { x: 2 }, 'fixture.drag');
    await pq.flushPersistQueue();
    expect(sent[0]!.map(e => e.type)).toEqual(['CmdA', 'CmdB', 'fixture.drag']);
    expect(sent[0]![2]!.payload).toEqual({ x: 2 });
  });

  it('stores plain JSON copies of payloads (proxies/functions are not cloneable)', async () => {
    wireHook();
    pq.enqueueLiveOp('x', { a: 1, fn: () => 1 }, 'x');
    await pq.flushPersistWal();
    const rows = await outboxRows();
    expect(rows[0]!.payload).toEqual({ a: 1 });
  });

  it('writes history commands immediately, in order with earlier live-ops', async () => {
    wireHook(async batch => batch.map(() => undefined));
    const op = pq.enqueueLiveOp('engine.bpm', { bpm: 90 }, 'engine.bpm');
    pq.enqueuePersist({ type: 'CmdA', payload: { a: 1 }, changeId: 'cmd-a' });
    // No settle-window wait: the command flushed the whole batch.
    await settle();
    const rows = await outboxRows();
    expect(rows.map(r => r.id)).toEqual([op, 'cmd-a']);
    expect(rows[1]).toMatchObject({ kind: 'command', type: 'CmdA' });
  });

  it('writes no outbox rows for local-only projects', async () => {
    pq.setPersistProjectId(projectId, { outbox: false });
    pq.enqueueLiveOp('engine.bpm', { bpm: 90 }, 'engine.bpm');
    pq.enqueuePersist({ type: 'CmdA', payload: {}, changeId: 'cmd-a' });
    await pq.flushPersistWal();
    expect(await outboxRows()).toEqual([]);
  });

  it('reports pending history commands (not live-ops)', () => {
    pq.enqueueLiveOp('x', {}, 'x');
    expect(pq.hasPendingCommandPersist()).toBe(false);
    pq.enqueuePersist({ type: 'Cmd', payload: {}, changeId: 'c' });
    expect(pq.hasPendingCommandPersist()).toBe(true);
  });
});

describe('persist queue — backoff + connectivity (D9)', () => {
  it('does not retry on a timer while offline and resumes on reconnect', async () => {
    let fail = true;
    const { hook } = wireHook(async (batch) => {
      if (fail) throw new TypeError('Failed to fetch');
      return batch.map((_, i) => i + 1);
    });

    pq.enqueuePersist({ type: 'Cmd', payload: {}, changeId: 'c1' });
    await vi.advanceTimersByTimeAsync(60);
    await settle();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(conn.isOnline.value).toBe(false);

    // Offline: new entries and a long wait never trigger a flush.
    pq.enqueuePersist({ type: 'Cmd', payload: {}, changeId: 'c2' });
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(hook).toHaveBeenCalledTimes(1);

    // Reconnect → flush both, in order.
    fail = false;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60);
    await settle();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[1]![0].map((e: { changeId?: string }) => e.changeId)).toEqual(['c1', 'c2']);
  });

  it('retries server errors with exponential backoff instead of 50 ms', async () => {
    const { hook } = wireHook(async () => { throw Object.assign(new Error('500'), { name: 'FunctionsHttpError' }); });

    pq.enqueuePersist({ type: 'Cmd', payload: {}, changeId: 'c1' });
    await vi.advanceTimersByTimeAsync(60);
    await settle();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(conn.isOnline.value).toBe(true); // HTTP error ≠ offline

    // First retry after backoffDelay(0) ∈ [400, 600] ms — not after 50 ms.
    await vi.advanceTimersByTimeAsync(350);
    await settle();
    expect(hook).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(hook).toHaveBeenCalledTimes(2);

    // Second retry after backoffDelay(1) ∈ [800, 1200] ms.
    await vi.advanceTimersByTimeAsync(700);
    await settle();
    expect(hook).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(hook).toHaveBeenCalledTimes(3);

    // New entries during backoff do not shorten the wait.
    pq.enqueuePersist({ type: 'Cmd', payload: {}, changeId: 'c2' });
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(hook).toHaveBeenCalledTimes(3);
  });

  it('keeps unacknowledged outbox rows when the server returns no sequence number', async () => {
    wireHook(async batch => batch.map(() => undefined));
    const id = pq.enqueueLiveOp('x', { v: 1 }, 'x');
    await pq.flushPersistQueue();
    await settle();
    expect((await outboxRows()).map(r => r.id)).toEqual([id]);
  });
});
