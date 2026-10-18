import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { walAppend, walAppendBatch, walGetPending, walMarkAcked, walNextEnqueuedAt, type WalEntry } from '~/utils/persistence/wal';

/** Build a WAL entry with sensible defaults. */
function entry(over: Partial<WalEntry> & Pick<WalEntry, 'id' | 'projectId'>): WalEntry {
  return { commandType: 'Test', payload: { v: over.id }, enqueuedAt: walNextEnqueuedAt(), ...over };
}

describe('wal', () => {
  it('issues strictly increasing enqueuedAt values', () => {
    const a = walNextEnqueuedAt();
    const b = walNextEnqueuedAt();
    const c = walNextEnqueuedAt();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('keeps legacy rows without kind/dedupKey and returns them in order', async () => {
    const p = 'p-legacy';
    await walAppend(entry({ id: 'a', projectId: p }));
    await walAppend(entry({ id: 'b', projectId: p, kind: 'command' }));
    const rows = await walGetPending(p);
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(rows[0]!.kind).toBeUndefined();
  });

  it('replaces older rows with the same dedupKey, leaving others untouched', async () => {
    const p = 'p-dedup';
    await walAppend(entry({ id: 'cmd-1', projectId: p, kind: 'command' }));
    await walAppend(entry({ id: 'bpm-1', projectId: p, kind: 'live-op', dedupKey: 'bpm' }));
    await walAppend(entry({ id: 'drag-1', projectId: p, kind: 'live-op', dedupKey: 'drag' }));
    await walAppend(entry({ id: 'bpm-2', projectId: p, kind: 'live-op', dedupKey: 'bpm' }));
    // Same dedupKey in another project must survive.
    await walAppend(entry({ id: 'other-bpm', projectId: 'p-other', kind: 'live-op', dedupKey: 'bpm' }));

    const rows = await walGetPending(p);
    expect(rows.map(r => r.id)).toEqual(['cmd-1', 'drag-1', 'bpm-2']);
    expect((await walGetPending('p-other')).map(r => r.id)).toEqual(['other-bpm']);
  });

  it('dedups inside a single batch (only the latest row per key is written)', async () => {
    const p = 'p-batch';
    await walAppendBatch([
      entry({ id: 'x1', projectId: p, kind: 'live-op', dedupKey: 'x' }),
      entry({ id: 'c1', projectId: p, kind: 'command' }),
      entry({ id: 'x2', projectId: p, kind: 'live-op', dedupKey: 'x' }),
    ]);
    expect((await walGetPending(p)).map(r => r.id)).toEqual(['c1', 'x2']);
  });

  it('removes acknowledged rows', async () => {
    const p = 'p-ack';
    await walAppendBatch([entry({ id: 'k1', projectId: p }), entry({ id: 'k2', projectId: p })]);
    await walMarkAcked(['k1', 'unknown']);
    expect((await walGetPending(p)).map(r => r.id)).toEqual(['k2']);
  });
});
