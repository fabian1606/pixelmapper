// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';
import { absoluteTime, relativeTime } from '~/utils/sync/relative-time';
import { collapseAutosaves, formatSummary, snapshotBadge, snapshotKind } from '~/utils/sync/version-history';
import {
  clearVersionHistoryCache,
  createVersionHistory,
  type RestoreEngine,
  type VersionHistoryDeps,
} from '~/utils/sync/version-history-controller';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';

/** List entry with defaults. */
function entry(seq: number, label: string | null = null): SnapshotListEntry {
  return {
    id: `s-${seq}`, sequenceNumber: seq, label, createdAt: '2026-10-18T10:00:00Z',
    createdBy: null, authorName: null, summary: { fixtures: 1, groups: 0, modifiers: 0 },
  };
}

/** Wire entry as returned by the function. */
const wire = (e: SnapshotListEntry) => ({ ...e });

/** Client that answers successive `list-snapshots` calls with `pages`. */
function pagedClient(pages: Array<{ snapshots: SnapshotListEntry[]; nextCursor: string | null } | Error>) {
  const invoke = vi.fn(async (_name: string, _opts?: { body?: Record<string, unknown> }) => {
    const page = pages.shift();
    if (!page) throw new Error('no more pages');
    if (page instanceof Error) return { data: null, error: page };
    return { data: { snapshots: page.snapshots.map(wire), nextCursor: page.nextCursor }, error: null };
  });
  return { client: { functions: { invoke } } as RemoteClient, invoke };
}

/** Controller deps with sensible defaults. */
function makeDeps(over: Partial<VersionHistoryDeps> = {}): VersionHistoryDeps & { online: ReturnType<typeof ref<boolean>> } {
  const online = ref(true);
  return {
    projectId: PID,
    isLocal: () => false,
    client: () => null,
    online,
    engine: () => null,
    pendingCount: () => 0,
    role: async () => 'owner',
    ...over,
  } as VersionHistoryDeps & { online: typeof online };
}

/** Fake engine; `pending` drops to `afterFlush` on flush. */
function fakeEngine(state: { pending: number; afterFlush: number; ok?: boolean }) {
  const engine: RestoreEngine & { restoreSnapshot: ReturnType<typeof vi.fn> } = {
    flushNow: vi.fn(async () => { state.pending = state.afterFlush; }),
    restoreSnapshot: vi.fn(async () => state.ok ?? true),
  };
  return engine;
}

beforeEach(() => {
  reportNetworkSuccess();
  clearVersionHistoryCache();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('labels and summary', () => {
  it('classifies labels', () => {
    expect(snapshotKind(null)).toBe('autosave');
    expect(snapshotKind('before offline sync')).toBe('before-sync');
    expect(snapshotKind('Uploaded')).toBe('uploaded');
    expect(snapshotKind('Imported')).toBe('imported');
    expect(snapshotKind('Restored from snapshot 12')).toBe('restored');
    expect(snapshotKind('Before show')).toBe('named');
    expect(snapshotBadge('Before show')).toEqual({ text: 'Before show', variant: 'secondary' });
    expect(snapshotBadge(null).text).toBe('Autosave');
  });

  it('formats summaries with plurals and hides zero groups', () => {
    expect(formatSummary({ fixtures: 1, groups: 0, modifiers: 2 })).toBe('1 fixture · 2 modifiers');
    expect(formatSummary({ fixtures: 12, groups: 1, modifiers: 1 })).toBe('12 fixtures · 1 group · 1 modifier');
  });

  it('formats times', () => {
    const t = Date.UTC(2026, 9, 18, 10, 0);
    expect(relativeTime(t, t + 30_000)).toBe('just now');
    expect(relativeTime(t, t + 5 * 60_000)).toBe('5 min ago');
    expect(relativeTime(t, t + 26 * 3600_000)).toBe('1 day ago');
    expect(absoluteTime(t)).toContain('2026');
    expect(absoluteTime(Number.NaN)).toBe('');
  });
});

describe('collapseAutosaves', () => {
  const list = [entry(9), entry(8), entry(7), entry(6), entry(5, 'Uploaded'), entry(4), entry(3)];

  it('keeps the newest autosave of a run and collapses the rest (runs of 3+)', () => {
    const rows = collapseAutosaves(list, new Set());
    expect(rows).toEqual([
      { type: 'entry', entry: list[0] },
      { type: 'collapsed', key: 's-8', count: 3 },
      { type: 'entry', entry: list[4] },
      // A run of 2 is not collapsed.
      { type: 'entry', entry: list[5] },
      { type: 'entry', entry: list[6] },
    ]);
  });

  it('expands a run by key', () => {
    const rows = collapseAutosaves(list, new Set(['s-8']));
    expect(rows.filter(r => r.type === 'entry')).toHaveLength(7);
  });
});

// ── Controller ───────────────────────────────────────────────────────────────

describe('createVersionHistory', () => {
  it('loads pages and appends older ones without duplicates', async () => {
    const { client, invoke } = pagedClient([
      { snapshots: [entry(9), entry(8)], nextCursor: 'c1' },
      { snapshots: [entry(8), entry(7)], nextCursor: null },
    ]);
    const h = createVersionHistory(makeDeps({ client: () => client, pageSize: 2 }));
    await h.refresh();
    expect(h.entries.value.map(e => e.sequenceNumber)).toEqual([9, 8]);
    expect(h.nextCursor.value).toBe('c1');

    await h.loadMore();
    expect(invoke.mock.calls[1]?.[1]?.body).toMatchObject({ before: 'c1', limit: 2 });
    expect(h.entries.value.map(e => e.sequenceNumber)).toEqual([9, 8, 7]);
    expect(h.nextCursor.value).toBeNull();
  });

  it('does nothing for local projects', async () => {
    const { client, invoke } = pagedClient([]);
    const h = createVersionHistory(makeDeps({ isLocal: () => true, client: () => client }));
    await h.refresh();
    expect(invoke).not.toHaveBeenCalled();
    expect(h.canRestore.value).toBe(false);
  });

  it('shows the cached list offline with restore disabled', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    await createVersionHistory(makeDeps({ client: () => client })).refresh();

    const deps = makeDeps({ client: () => client });
    deps.online.value = false;
    const h = createVersionHistory(deps);
    await h.refresh();
    expect(h.entries.value.map(e => e.id)).toEqual(['s-3']);
    expect(h.stale.value).toBe(true);
    expect(h.canRestore.value).toBe(false);
  });

  it('disables restore for viewers', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    const h = createVersionHistory(makeDeps({ client: () => client, role: async () => 'viewer' }));
    await h.refresh();
    await Promise.resolve();
    expect(h.role.value).toBe('viewer');
    expect(h.canRestore.value).toBe(false);
    expect(await h.restore(entry(3))).toBe('unavailable');
  });

  it('reports a server error but keeps the cached list', async () => {
    const err = Object.assign(new Error('x'), { context: new Response('{"error":"boom"}', { status: 500 }) });
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }, err]);
    await createVersionHistory(makeDeps({ client: () => client })).refresh();
    const h = createVersionHistory(makeDeps({ client: () => client }));
    await h.refresh();
    expect(h.error.value).toBe('Could not load version history.');
    expect(h.entries.value).toHaveLength(1);
  });

  it('restores directly when nothing is pending', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    const state = { pending: 0, afterFlush: 0 };
    const engine = fakeEngine(state);
    const h = createVersionHistory(makeDeps({ client: () => client, engine: () => engine, pendingCount: () => state.pending }));
    await h.refresh();
    expect(await h.restore(entry(3))).toBe('restored');
    expect(engine.flushNow).not.toHaveBeenCalled();
    expect(engine.restoreSnapshot).toHaveBeenCalledWith('s-3');
    expect(h.restoringId.value).toBeNull();
  });

  it('flushes pending changes before restoring', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    const state = { pending: 2, afterFlush: 0 };
    const engine = fakeEngine(state);
    const h = createVersionHistory(makeDeps({ client: () => client, engine: () => engine, pendingCount: async () => state.pending }));
    await h.refresh();
    expect(await h.restore(entry(3))).toBe('restored');
    expect(engine.flushNow).toHaveBeenCalledOnce();
  });

  it('refuses when pending changes cannot be flushed', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    const state = { pending: 2, afterFlush: 1 };
    const engine = fakeEngine(state);
    const h = createVersionHistory(makeDeps({ client: () => client, engine: () => engine, pendingCount: () => state.pending }));
    await h.refresh();
    expect(await h.restore(entry(3))).toBe('pending');
    expect(engine.restoreSnapshot).not.toHaveBeenCalled();
  });

  it('reports a failed restore and needs an engine', async () => {
    const { client } = pagedClient([{ snapshots: [entry(3)], nextCursor: null }]);
    const engine = fakeEngine({ pending: 0, afterFlush: 0, ok: false });
    let current: RestoreEngine | null = null;
    const h = createVersionHistory(makeDeps({ client: () => client, engine: () => current }));
    await h.refresh();
    expect(await h.restore(entry(3))).toBe('unavailable');
    current = engine;
    expect(await h.restore(entry(3))).toBe('failed');
  });
});
