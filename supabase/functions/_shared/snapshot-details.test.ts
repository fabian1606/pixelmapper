// Run with: bun test supabase/functions/_shared
// Validation and response shaping of snapshot-details (version history).
import { describe, expect, test } from 'bun:test';
import {
  type ActivityRow,
  detailRanges,
  parseSnapshotDetails,
  type RestoreMarkerRow,
  type SnapshotPairRow,
  splitPair,
  toSnapshotDetailsResponse,
} from './snapshot-details.ts';

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const AT = '2026-10-18T10:00:00.123456+00:00';

/** Pair row with defaults. */
function pairRow(slot: string, id: string, seq: number | string, over: Partial<SnapshotPairRow> = {}): SnapshotPairRow {
  return { slot, id, sequence_number: seq, label: null, created_at: AT, snapshot: { sceneNodes: [] }, ...over };
}

/** Restore marker row with defaults. */
function marker(seq: number, over: Partial<RestoreMarkerRow> = {}): RestoreMarkerRow {
  return {
    sequence_number: seq, created_at: AT, user_id: 'u1', author_name: 'Ada',
    source_snapshot_id: CID, source_sequence: 3, source_created_at: AT, source_label: null, ...over,
  };
}

describe('parseSnapshotDetails', () => {
  test('accepts ids and lower-cases them', () => {
    const r = parseSnapshotDetails({ projectId: PID.toUpperCase(), snapshotId: SID, compareToId: CID.toUpperCase() });
    expect(r).toEqual({ ok: true, value: { projectId: PID, snapshotId: SID, compareToId: CID } });
  });
  test('compareToId is optional (null)', () => {
    expect(parseSnapshotDetails({ projectId: PID, snapshotId: SID })).toEqual({ ok: true, value: { projectId: PID, snapshotId: SID, compareToId: null } });
    expect(parseSnapshotDetails({ projectId: PID, snapshotId: SID, compareToId: null }).ok).toBe(true);
  });
  test.each([
    [null, 'projectId and snapshotId required'],
    [{ projectId: PID }, 'projectId and snapshotId required'],
    [{ projectId: 'x', snapshotId: SID }, 'projectId must be a UUID'],
    [{ projectId: PID, snapshotId: 'x' }, 'snapshotId must be a UUID'],
    [{ projectId: PID, snapshotId: SID, compareToId: 'x' }, 'compareToId must be a UUID'],
    [{ projectId: PID, snapshotId: SID, compareToId: 5 }, 'compareToId must be a UUID'],
  ])('rejects %j', (body, error) => {
    expect(parseSnapshotDetails(body as Record<string, unknown> | null)).toEqual({ ok: false, error });
  });
});

describe('splitPair', () => {
  test('maps current and previous (bigint as string, non-object snapshot → {})', () => {
    const { current, previous } = splitPair([pairRow('previous', CID, '4', { snapshot: 'bad' }), pairRow('current', SID, 9)]);
    expect(current).toEqual({ id: SID, sequenceNumber: 9, label: null, createdAt: AT, data: { sceneNodes: [] } });
    expect(previous).toMatchObject({ id: CID, sequenceNumber: 4, data: {} });
  });
  test('missing current → null', () => {
    expect(splitPair([]).current).toBeNull();
  });
});

describe('detailRanges', () => {
  const snap = (seq: number) => ({ id: SID, sequenceNumber: seq, label: null, createdAt: AT, data: {} });
  test('activity between previous and current', () => {
    expect(detailRanges(snap(9), snap(4))).toEqual({ activity: { after: 4, upto: 9 }, restores: { after: 4, upto: 9 } });
  });
  test('same sequence: empty activity range, restore at current still found', () => {
    expect(detailRanges(snap(9), snap(9))).toEqual({ activity: { after: 9, upto: 9 }, restores: { after: 8, upto: 9 } });
  });
  test('first version: no activity, restore marker at its sequence only', () => {
    expect(detailRanges(snap(9), null)).toEqual({ activity: null, restores: { after: 8, upto: 9 } });
  });
});

describe('toSnapshotDetailsResponse', () => {
  const cur = { id: SID, sequenceNumber: 9, label: 'Restored from snapshot 3', createdAt: AT, data: {} };
  const prev = { id: CID, sequenceNumber: 4, label: null, createdAt: AT, data: {} };
  const activity: ActivityRow[] = [
    { user_id: 'u1', author_name: 'Ada', command_type: 'MoveFixture', change_count: '3' },
    { user_id: 'u2', author_name: null, command_type: 'SetModifiers', change_count: 0 },
  ];

  test('maps activity, sorts restores and finds restoredFrom', () => {
    const res = toSnapshotDetailsResponse(cur, prev, activity, [marker(6), marker(9, { source_sequence: '3' })]);
    expect(res.activity).toEqual([{ userId: 'u1', authorName: 'Ada', commandType: 'MoveFixture', count: 3 }]);
    expect(res.restores.map(r => r.sequenceNumber)).toEqual([9, 6]);
    expect(res.restoredFrom).toMatchObject({ sequenceNumber: 9, snapshotId: CID, sourceSequence: 3 });
  });
  test('first version: restoredFrom only, no restores list', () => {
    const res = toSnapshotDetailsResponse(cur, null, [], [marker(9)]);
    expect(res.previous).toBeNull();
    expect(res.restores).toEqual([]);
    expect(res.restoredFrom?.sequenceNumber).toBe(9);
  });
  test('no marker at the current sequence → restoredFrom null', () => {
    expect(toSnapshotDetailsResponse(cur, prev, [], [marker(6)]).restoredFrom).toBeNull();
  });
});
