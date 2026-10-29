// @vitest-environment node
/**
 * Version-history details: activity labels, view model and the lazy
 * loading controller (cache, offline, error + retry).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { SnapshotDetails } from '~/utils/sync/remote-api-snapshot-details';
import { activityLabel, COMMAND_LABELS, formatAuthorActivity, formatRestore, restoredSequenceFromLabel, summarizeActivity } from '~/utils/sync/version-activity';
import { clearVersionDetailsCache, createVersionDetails } from '~/utils/sync/version-details-controller';
import { buildVersionDetailsView, capLines } from '~/utils/sync/version-details-view';

// ── Activity labels ──────────────────────────────────────────────────────────

describe('activity labels', () => {
  it.each([
    ['MoveFixture', 'Move fixture'],
    ['fixture.drag', 'Move fixture'],
    ['modifier.update', 'Change effect'],
    ['SetModifiers', 'Change effects'],
    ['live.addPage', 'Add live page'],
    ['engine.bpm', 'Change BPM'],
    ['SomethingNew', 'SomethingNew'],
  ])('%s → %s', (type, label) => {
    expect(activityLabel(type)).toBe(label);
  });

  it('every label is non-empty', () => {
    expect(Object.values(COMMAND_LABELS).every(l => l.trim().length > 0)).toBe(true);
  });

  it('aggregates per author, merges equal labels, sorts by count', () => {
    const lines = summarizeActivity([
      { userId: 'u1', authorName: 'Ada', commandType: 'modifier.update', count: 1 },
      { userId: 'u1', authorName: 'Ada', commandType: 'MoveFixture', count: 2 },
      { userId: 'u1', authorName: 'Ada', commandType: 'fixture.drag', count: 1 },
      { userId: 'u2', authorName: null, commandType: 'X', count: 9 },
      { userId: 'u3', authorName: 'Zed', commandType: 'X', count: 0 },
    ]).map(formatAuthorActivity);
    expect(lines).toEqual(['Unknown author · 9× X', 'Ada · 3× Move fixture · 1× Change effect']);
  });

  it('restore lines and label parsing', () => {
    const base = { sequenceNumber: 9, createdAt: null, userId: 'u', authorName: 'Ada', snapshotId: null, sourceLabel: null };
    expect(formatRestore({ ...base, sourceSequence: 4, sourceCreatedAt: null })).toBe('Restored the version at change #4 · Ada');
    expect(formatRestore({ ...base, authorName: null, sourceSequence: null, sourceCreatedAt: null })).toBe('Restored an earlier version');
    expect(formatRestore({ ...base, sourceSequence: 4, sourceCreatedAt: '2026-10-18T10:00:00Z' })).toMatch(/^Restored the version from Oct 18, 2026/);
    expect(restoredSequenceFromLabel('Restored from snapshot 12')).toBe(12);
    expect(restoredSequenceFromLabel('Uploaded')).toBeNull();
  });
});

// ── View model ───────────────────────────────────────────────────────────────

/** Details response with defaults. */
function details(over: Partial<SnapshotDetails> = {}): SnapshotDetails {
  const fx = (id: number, x = 0) => ({ _type: 'fixture', id, name: `F${id}`, fixturePosition: { x, y: 0 } });
  return {
    snapshot: { id: 's2', sequenceNumber: 9, label: null, createdAt: null, data: { sceneNodes: [fx(1, 5), fx(2)], globalBpm: 128 } },
    previous: { id: 's1', sequenceNumber: 4, label: null, createdAt: null, data: { sceneNodes: [fx(1)], globalBpm: 120 } },
    activity: [{ userId: 'u1', authorName: 'Ada', commandType: 'MoveFixture', count: 2 }],
    restores: [],
    restoredFrom: null,
    ...over,
  };
}

describe('buildVersionDetailsView', () => {
  it('sections, activity and settings', () => {
    const v = buildVersionDetailsView(details());
    expect(v.first).toBe(false);
    expect(v.sections).toEqual([
      { title: 'Fixtures', lines: [{ kind: 'added', text: 'F2' }, { kind: 'changed', text: 'F1: position' }], more: 0 },
      { title: 'Project settings', lines: [{ kind: 'changed', text: 'BPM: 120 → 128' }], more: 0 },
    ]);
    expect(v.activity).toEqual(['Ada · 2× Move fixture']);
  });

  it('first version, restored from label', () => {
    const v = buildVersionDetailsView(details({ previous: null, snapshot: { id: 's', sequenceNumber: 9, label: 'Restored from snapshot 3', createdAt: null, data: {} } }));
    expect(v).toMatchObject({ first: true, sections: [], restoredFrom: 'Restored the version at change #3' });
  });

  it('no changes', () => {
    const same = { id: 's', sequenceNumber: 1, label: null, createdAt: null, data: { globalBpm: 120 } };
    expect(buildVersionDetailsView(details({ snapshot: same, previous: same, activity: [] })).noChanges).toBe(true);
  });

  it('caps lines', () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ kind: 'added' as const, text: String(i) }));
    expect(capLines('X', lines)).toMatchObject({ more: 3 });
    expect(capLines('X', lines).lines).toHaveLength(8);
  });
});

// ── Controller ───────────────────────────────────────────────────────────────

const PID = 'p1';

/** Controller with a mock client; `outcomes` are returned in order. */
function setup(outcomes: { data: unknown; error: unknown }[], online = true) {
  const invoke = vi.fn(async () => outcomes.shift() ?? { data: null, error: new TypeError('Failed to fetch') });
  const client: RemoteClient = { functions: { invoke } };
  const onlineRef = ref(online);
  const ctl = createVersionDetails({ projectId: PID, client: () => client, online: onlineRef });
  return { ctl, invoke, onlineRef };
}

/** Response body of `snapshot-details`. */
const okBody = () => ({ data: details(), error: null });
const serverError = () => {
  const err = new Error('x') as Error & { context: Response };
  err.context = new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
  return { data: null, error: err };
};

afterEach(() => {
  clearVersionDetailsCache();
  vi.restoreAllMocks();
});

describe('createVersionDetails', () => {
  it('loads once, passes compareToId and caches per project + snapshot', async () => {
    const { ctl, invoke } = setup([okBody()]);
    expect(ctl.state('s2').value.status).toBe('idle');
    await Promise.all([ctl.load('s2', 's1'), ctl.load('s2', 's1')]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('snapshot-details', { body: { projectId: PID, snapshotId: 's2', compareToId: 's1' } });
    expect(ctl.state('s2').value.status).toBe('ready');

    // A new controller (popover reopened, now offline) starts from the cache.
    const again = setup([], false);
    expect(again.ctl.state('s2').value.status).toBe('ready');
    await again.ctl.load('s2');
    expect(again.invoke).not.toHaveBeenCalled();
  });

  it('offline without cache → offline; online again → loads', async () => {
    const { ctl, invoke, onlineRef } = setup([okBody()], false);
    await ctl.load('s2');
    expect(ctl.state('s2').value.status).toBe('offline');
    expect(invoke).not.toHaveBeenCalled();
    onlineRef.value = true;
    await ctl.load('s2');
    expect(ctl.state('s2').value.status).toBe('ready');
  });

  it('network failure → offline', async () => {
    const { ctl } = setup([]);
    await ctl.load('s2');
    expect(ctl.state('s2').value.status).toBe('offline');
  });

  it('server error → error, retry succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctl } = setup([serverError(), okBody()]);
    await ctl.load('s2');
    expect(ctl.state('s2').value).toMatchObject({ status: 'error', error: 'Could not load the changes.' });
    await ctl.load('s2');
    expect(ctl.state('s2').value.status).toBe('ready');
    expect(ctl.state('s2').value.view?.activity).toEqual(['Ada · 2× Move fixture']);
  });
});
