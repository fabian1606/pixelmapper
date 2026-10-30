// Run with: bun test supabase/functions/_shared
// Validation and response shaping of list-snapshots (version history).
import { describe, expect, test } from 'bun:test';
import { type SnapshotSummaryRow, toSnapshotListResponse } from './snapshot-list.ts';
import {
  decodeSnapshotCursor,
  encodeSnapshotCursor,
  parseListSnapshots,
  SNAPSHOTS_DEFAULT_LIMIT,
  SNAPSHOTS_MAX_LIMIT,
} from './validate.ts';

const ID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const SNAP = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const AT = '2026-10-18T10:00:00.123456+00:00';

/** RPC row with defaults. */
function row(seq: number, over: Partial<SnapshotSummaryRow> = {}): SnapshotSummaryRow {
  return {
    id: SNAP, sequence_number: seq, label: null, created_at: AT, created_by: null,
    author_name: null, fixtures: 3, groups: 1, modifiers: 2, ...over,
  };
}

describe('snapshot cursor', () => {
  test('round-trips with microsecond timestamps', () => {
    const c = { sequenceNumber: 42, createdAt: AT, id: SNAP };
    expect(decodeSnapshotCursor(encodeSnapshotCursor(c))).toEqual(c);
  });
  test('lower-cases the id', () => {
    expect(decodeSnapshotCursor(`1~${AT}~${SNAP.toUpperCase()}`)?.id).toBe(SNAP);
  });
  test('rejects malformed cursors', () => {
    for (const v of [42, '', '1~x', `x~${AT}~${SNAP}`, `-1~${AT}~${SNAP}`, `1~not-a-date~${SNAP}`, `1~${AT}~nope`, `1~${AT}~${SNAP}~x`]) {
      expect(decodeSnapshotCursor(v)).toBeNull();
    }
  });
});

describe('parseListSnapshots', () => {
  test('defaults: first page, default limit', () => {
    expect(parseListSnapshots({ projectId: ID }))
      .toEqual({ ok: true, value: { projectId: ID, limit: SNAPSHOTS_DEFAULT_LIMIT, before: null } });
  });
  test('clamps the limit and decodes the cursor', () => {
    const r = parseListSnapshots({ projectId: ID, limit: 10_000, before: `7~${AT}~${SNAP}` });
    expect(r.ok && r.value.limit).toBe(SNAPSHOTS_MAX_LIMIT);
    expect(r.ok && r.value.before).toEqual({ sequenceNumber: 7, createdAt: AT, id: SNAP });
  });
  test('rejects invalid input', () => {
    expect(parseListSnapshots(null).ok).toBe(false);
    expect(parseListSnapshots({ projectId: 'x' }).ok).toBe(false);
    expect(parseListSnapshots({ projectId: ID, limit: 0 }).ok).toBe(false);
    expect(parseListSnapshots({ projectId: ID, limit: 1.5 }).ok).toBe(false);
    expect(parseListSnapshots({ projectId: ID, before: 'garbage' }).ok).toBe(false);
  });
});

describe('toSnapshotListResponse', () => {
  test('maps rows to camelCase entries without snapshot JSON', () => {
    const res = toSnapshotListResponse([row(5, { label: 'Uploaded', author_name: 'Ada', created_by: ID, sequence_number: '5' })], 10);
    expect(res).toEqual({
      snapshots: [{
        id: SNAP, sequenceNumber: 5, label: 'Uploaded', createdAt: AT, createdBy: ID, authorName: 'Ada',
        summary: { fixtures: 3, groups: 1, modifiers: 2 },
      }],
      nextCursor: null,
    });
  });
  test('an extra row yields a cursor at the last returned row', () => {
    const res = toSnapshotListResponse([row(9), row(8), row(7)], 2);
    expect(res.snapshots.map(s => s.sequenceNumber)).toEqual([9, 8]);
    expect(res.nextCursor).toBe(`8~${AT}~${SNAP}`);
  });
  test('null counts become 0', () => {
    const res = toSnapshotListResponse([row(1, { fixtures: null, groups: null, modifiers: null })], 5);
    expect(res.snapshots[0]?.summary).toEqual({ fixtures: 0, groups: 0, modifiers: 0 });
  });
});
