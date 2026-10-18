// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergeObjects, mergeValues } from './merge-values';

/** Tests of the field-level 3-way merge of plain objects and values. */

// ── Property-like table ──────────────────────────────────────────────────────

describe('mergeObjects: single field table', () => {
  // [name, base, local, remote, expected, conflict expected]
  const cases: Array<[string, unknown, unknown, unknown, unknown, boolean]> = [
    ['unchanged', 1, 1, 1, 1, false],
    ['local changed', 1, 2, 1, 2, false],
    ['remote changed', 1, 1, 3, 3, false],
    ['both changed to same value', 1, 5, 5, 5, false],
    ['both changed differently → local', 1, 2, 3, 2, true],
    ['local deleted', 1, undefined, 1, undefined, false],
    ['remote deleted', 1, 1, undefined, undefined, false],
    ['local deleted, remote modified → local (deleted)', 1, undefined, 3, undefined, true],
    ['local added', undefined, 7, undefined, 7, false],
    ['remote added', undefined, undefined, 7, 7, false],
    ['both added differently → local', undefined, 'a', 'b', 'a', true],
    ['primitive array changed both → atomic local', [1, 2], [1, 2, 3], [0, 1, 2], [1, 2, 3], true],
    ['primitive array changed one side', [1, 2], [1, 2], [2, 1], [2, 1], false],
    ['array without ids atomic', [{ x: 1 }], [{ x: 2 }], [{ x: 3 }], [{ x: 2 }], true],
    ['type change both sides → local', 1, { a: 1 }, 'x', { a: 1 }, true],
    ['null is a value', 1, null, 1, null, false],
  ];

  it.each(cases)('%s', (_name, base, local, remote, expected, hasConflict) => {
    const { value, conflicts } = mergeObjects({ f: base }, { f: local }, { f: remote });
    expect(value.f).toEqual(expected);
    expect('f' in value).toBe(expected !== undefined);
    expect(conflicts.length > 0).toBe(hasConflict);
    if (hasConflict) {
      expect(conflicts[0]).toMatchObject({ entityId: null, path: ['f'], kind: 'modify-modify' });
      expect(conflicts[0]!.local).toEqual(local);
      expect(conflicts[0]!.remote).toEqual(remote);
      expect(conflicts[0]!.base).toEqual(base);
    }
  });
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('mergeObjects: structure', () => {
  it('merges disjoint field changes', () => {
    const base = { a: 1, b: 1, c: 1 };
    const { value, conflicts } = mergeObjects(base, { a: 2, b: 1, c: 1 }, { a: 1, b: 3, c: 1 });
    expect(value).toEqual({ a: 2, b: 3, c: 1 });
    expect(conflicts).toEqual([]);
  });

  it('recurses into nested objects and reports the full path', () => {
    const base = { params: { speed: 1, color: { r: 0, g: 0 } } };
    const local = { params: { speed: 2, color: { r: 255, g: 0 } } };
    const remote = { params: { speed: 1, color: { r: 128, g: 9 } } };
    const { value, conflicts } = mergeObjects(base, local, remote);
    expect(value).toEqual({ params: { speed: 2, color: { r: 255, g: 9 } } });
    expect(conflicts).toEqual([
      { entityId: null, path: ['params', 'color', 'r'], base: 0, local: 255, remote: 128, kind: 'modify-modify' },
    ]);
  });

  it('treats a missing base as an add on both sides', () => {
    const { value, conflicts } = mergeObjects(undefined, { a: 1, b: 2 }, { a: 1, c: 3 });
    expect(value).toEqual({ a: 1, b: 2, c: 3 });
    expect(conflicts).toEqual([]);
  });

  it('never aliases inputs', () => {
    const base = { n: { x: 1 }, list: [1] };
    const local = { n: { x: 1 }, list: [1] };
    const remote = { n: { x: 2 }, list: [1] };
    const { value } = mergeObjects(base, local, remote);
    expect(value.n).not.toBe(remote.n);
    expect(value.list).not.toBe(local.list);
    value.n.x = 99;
    expect(remote.n.x).toBe(2);
  });

  it('does not mutate inputs', () => {
    const base = { a: { b: 1 } };
    const local = { a: { b: 2 } };
    const remote = { a: { b: 3 }, c: 1 };
    const snapshot = JSON.stringify([base, local, remote]);
    mergeObjects(base, local, remote);
    expect(JSON.stringify([base, local, remote])).toBe(snapshot);
  });

  it('merges nested entity lists by id', () => {
    const base = { cats: [{ id: 'a', v: 1 }] };
    const local = { cats: [{ id: 'a', v: 2 }] };
    const remote = { cats: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] };
    const { value, conflicts } = mergeObjects(base, local, remote);
    expect(value.cats).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }]);
    expect(conflicts).toEqual([]);
  });
});

describe('mergeValues', () => {
  it('merges top-level primitives', () => {
    expect(mergeValues(1, 2, 1).value).toBe(2);
    expect(mergeValues(1, 1, 3).value).toBe(3);
    const res = mergeValues(1, 2, 3);
    expect(res.value).toBe(2);
    expect(res.conflicts[0]).toMatchObject({ path: [], kind: 'modify-modify' });
  });
});
