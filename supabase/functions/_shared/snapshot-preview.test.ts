// Run with: bun test supabase/functions/_shared
// Validation and layout normalization of snapshot-preview (version-history hover).
import { describe, expect, test } from 'bun:test';
import { normalizeLayout, parseSnapshotPreview, PREVIEW_MAX_FIXTURES, PREVIEW_MAX_GROUPS } from './snapshot-preview.ts';

const PID = '3f2b8c1e-9a4d-4e1f-8b2a-0c6d7e8f9a0b';
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseSnapshotPreview', () => {
  test('accepts ids and lower-cases them', () => {
    expect(parseSnapshotPreview({ projectId: PID.toUpperCase(), snapshotId: SID.toUpperCase() }))
      .toEqual({ ok: true, value: { projectId: PID, snapshotId: SID, compareToId: null } });
  });
  test('optional compareToId (null / missing / UUID)', () => {
    expect(parseSnapshotPreview({ projectId: PID, snapshotId: SID, compareToId: null }))
      .toEqual({ ok: true, value: { projectId: PID, snapshotId: SID, compareToId: null } });
    expect(parseSnapshotPreview({ projectId: PID, snapshotId: SID, compareToId: PID.toUpperCase() }))
      .toEqual({ ok: true, value: { projectId: PID, snapshotId: SID, compareToId: PID } });
  });
  test.each([
    [null, 'projectId and snapshotId required'],
    [{ projectId: PID }, 'projectId and snapshotId required'],
    [{ projectId: PID, snapshotId: 5 }, 'projectId and snapshotId required'],
    [{ projectId: 'x', snapshotId: SID }, 'projectId must be a UUID'],
    [{ projectId: PID, snapshotId: 'x' }, 'snapshotId must be a UUID'],
    [{ projectId: PID, snapshotId: SID, compareToId: 'x' }, 'compareToId must be a UUID'],
    [{ projectId: PID, snapshotId: SID, compareToId: 5 }, 'compareToId must be a UUID'],
  ])('rejects %j', (body, error) => {
    expect(parseSnapshotPreview(body as Record<string, unknown> | null)).toEqual({ ok: false, error });
  });
});

describe('normalizeLayout', () => {
  test('null / non-object → null (snapshot not found)', () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout([])).toBeNull();
    expect(normalizeLayout('x')).toBeNull();
  });

  test('passes valid tuples through', () => {
    const raw = {
      fixtures: [[0.5, 0.25, 1.5, 1, 90, '#ff00aa', 1, 16, 0], [0.1, 0.2, 1, 1, 0, null, 0, 1, -1]],
      groups: [['Truss']],
      total: 2,
      truncated: false,
    };
    expect(normalizeLayout(raw)).toEqual(raw);
  });

  test('drops malformed tuples and fills defaults', () => {
    const res = normalizeLayout({ fixtures: [null, 'x', [1], ['a', 0.5], [0.3, 0.4]], groups: [], total: 5 });
    expect(res?.fixtures).toEqual([[0.3, 0.4, 1, 1, 0, null, 0, 0, -1]]);
    expect(res?.total).toBe(5);
    expect(res?.truncated).toBe(true);
  });

  test('clamps values and rejects invalid colour / shape / group', () => {
    const res = normalizeLayout({
      fixtures: [[-2, 7, 0, 1e9, 725.4, 'red', 9, 999, 3], [0.5, 0.5, 1, 1, 0, '#ABCDEF', 2, -4, 0]],
      groups: [['G']],
      total: 2,
      truncated: false,
    });
    expect(res?.fixtures).toEqual([
      [0, 1, 0.01, 100, 5, null, 0, 256, -1],
      [0.5, 0.5, 1, 1, 0, '#abcdef', 2, 0, 0],
    ]);
    expect(res?.truncated).toBe(false);
  });

  test('malformed groups keep their slot; names cut to 60 chars', () => {
    const res = normalizeLayout({ fixtures: [[0, 0, 1, 1, 0, null, 0, 1, 1]], groups: [5, ['x'.repeat(80)]], total: 1 });
    expect(res?.groups).toEqual([[''], ['x'.repeat(60)]]);
    expect(res?.fixtures[0][8]).toBe(1);
  });

  test('caps fixtures and groups; total never below the returned count', () => {
    const many = Array.from({ length: PREVIEW_MAX_FIXTURES + 5 }, () => [0.5, 0.5]);
    const groups = Array.from({ length: PREVIEW_MAX_GROUPS + 3 }, (_, i) => [`g${i}`]);
    const res = normalizeLayout({ fixtures: many, groups, total: 0 });
    expect(res?.fixtures.length).toBe(PREVIEW_MAX_FIXTURES);
    expect(res?.groups.length).toBe(PREVIEW_MAX_GROUPS);
    expect(res?.total).toBe(PREVIEW_MAX_FIXTURES);
  });

  test('truncated flag from the RPC is kept', () => {
    expect(normalizeLayout({ fixtures: [], groups: [], total: 0, truncated: true })?.truncated).toBe(true);
  });
});
