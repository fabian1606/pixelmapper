// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergeEntityLists } from './merge-entity-lists';

/** Tests of the 3-way merge of entity lists (ADR 0004 §3.3). */

/** Minimal effect-like entity. */
interface Fx {
  id: string | number;
  name?: string;
  params?: Record<string, unknown>;
  tags?: string[];
}

/** Ids of a list, for order assertions. */
const ids = (list: Fx[]) => list.map(e => e.id);

// ── Key scenario ─────────────────────────────────────────────────────────────

describe('key scenario', () => {
  it('local edit of A.speed and remote add of B both survive', () => {
    const base: Fx[] = [{ id: 'A', params: { speed: 1, size: 1 } }];
    const local: Fx[] = [{ id: 'A', params: { speed: 5, size: 1 } }];
    const remote: Fx[] = [{ id: 'A', params: { speed: 1, size: 1 } }, { id: 'B', params: { speed: 2 } }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual([
      { id: 'A', params: { speed: 5, size: 1 } },
      { id: 'B', params: { speed: 2 } },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('same field changed on both sides → local wins, conflict reported', () => {
    const base: Fx[] = [{ id: 'A', params: { speed: 1 } }];
    const local: Fx[] = [{ id: 'A', params: { speed: 5 } }];
    const remote: Fx[] = [{ id: 'A', params: { speed: 9 } }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual([{ id: 'A', params: { speed: 5 } }]);
    expect(conflicts).toEqual([
      { entityId: 'A', path: ['A', 'params', 'speed'], base: 1, local: 5, remote: 9, kind: 'modify-modify' },
    ]);
  });
});

// ── Add / remove table ───────────────────────────────────────────────────────

describe('add/remove table', () => {
  const X0: Fx = { id: 'x', name: 'x' };
  const X1: Fx = { id: 'x', name: 'x-changed' };
  // [name, base, local, remote, expected, conflict kinds]
  const cases: Array<[string, Fx[], Fx[], Fx[], Fx[], string[]]> = [
    ['all empty', [], [], [], [], []],
    ['local add', [], [X0], [], [X0], []],
    ['remote add', [], [], [X0], [X0], []],
    ['both add identical', [], [X0], [X0], [X0], []],
    ['both add different → field merge, local wins', [], [X0], [X1], [X0], ['modify-modify']],
    ['local remove, remote untouched', [X0], [], [X0], [], []],
    ['remote remove, local untouched', [X0], [X0], [], [], []],
    ['both remove', [X0], [], [], [], []],
    ['local remove, remote modify → kept modified', [X0], [], [X1], [X1], ['remove-modify']],
    ['remote remove, local modify → kept modified', [X0], [X1], [], [X1], ['remove-modify']],
  ];

  it.each(cases)('%s', (_name, base, local, remote, expected, kinds) => {
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual(expected);
    expect(conflicts.map(c => c.kind)).toEqual(kinds);
  });

  it('remove-vs-modify conflict carries all three versions', () => {
    const { conflicts } = mergeEntityLists([X0], [], [X1]);
    expect(conflicts[0]).toEqual({ entityId: 'x', path: ['x'], base: X0, local: undefined, remote: X1, kind: 'remove-modify' });
  });
});

// ── Order ────────────────────────────────────────────────────────────────────

describe('ordering', () => {
  const e = (id: string | number): Fx => ({ id });

  it('uses remote order and inserts local additions after their local predecessor', () => {
    const base = [e('a'), e('b'), e('c')];
    const local = [e('a'), e('L1'), e('L2'), e('b'), e('c'), e('L3')];
    const remote = [e('R0'), e('a'), e('b'), e('R1'), e('c')];
    const { value } = mergeEntityLists(base, local, remote);
    expect(ids(value)).toEqual(['R0', 'a', 'L1', 'L2', 'b', 'R1', 'c', 'L3']);
  });

  it('inserts a local addition without predecessor at the front', () => {
    const { value } = mergeEntityLists([e('a')], [e('L'), e('a')], [e('a'), e('R')]);
    expect(ids(value)).toEqual(['L', 'a', 'R']);
  });

  it('keeps a remote reorder', () => {
    const { value, conflicts } = mergeEntityLists([e('a'), e('b'), e('c')], [e('a'), e('b'), e('c')], [e('c'), e('a'), e('b')]);
    expect(ids(value)).toEqual(['c', 'a', 'b']);
    expect(conflicts).toEqual([]);
  });

  it('keeps a local-only reorder (and still adds remote entities)', () => {
    const base = [e('a'), e('b'), e('c')];
    const local = [e('c'), e('b'), e('a')];
    const remote = [e('a'), e('b'), e('R'), e('c')];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(ids(value)).toEqual(['c', 'b', 'R', 'a']);
    expect(conflicts).toEqual([]);
  });

  it('both reordered differently → local order wins, order conflict', () => {
    const base = [e('a'), e('b'), e('c')];
    const { value, conflicts } = mergeEntityLists(base, [e('b'), e('a'), e('c')], [e('a'), e('c'), e('b')]);
    expect(ids(value)).toEqual(['b', 'a', 'c']);
    expect(conflicts).toEqual([
      { entityId: null, path: [], base: ['a', 'b', 'c'], local: ['b', 'a', 'c'], remote: ['a', 'c', 'b'], kind: 'order' },
    ]);
  });

  it('both reordered identically → no conflict', () => {
    const base = [e('a'), e('b')];
    const { value, conflicts } = mergeEntityLists(base, [e('b'), e('a')], [e('b'), e('a')]);
    expect(ids(value)).toEqual(['b', 'a']);
    expect(conflicts).toEqual([]);
  });

  it('places an entity kept by remove-vs-modify after its local predecessor', () => {
    const base = [e('a'), { id: 'b', name: 'b' }, e('c')];
    const local = [e('a'), { id: 'b', name: 'B!' }, e('c')];
    const remote = [e('a'), e('c')];
    const { value } = mergeEntityLists<Fx>(base, local, remote);
    expect(ids(value)).toEqual(['a', 'b', 'c']);
  });
});

// ── Ids, nesting, fallbacks ──────────────────────────────────────────────────

describe('ids and nesting', () => {
  it('supports numeric ids (distinct from string ids)', () => {
    const base: Fx[] = [{ id: 1, name: 'one' }];
    const local: Fx[] = [{ id: 1, name: 'uno' }];
    const remote: Fx[] = [{ id: 1, name: 'one' }, { id: '1', name: 'string one' }, { id: 2, name: 'two' }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual([{ id: 1, name: 'uno' }, { id: '1', name: 'string one' }, { id: 2, name: 'two' }]);
    expect(conflicts).toEqual([]);
  });

  it('honours a custom idKey', () => {
    const base = [{ key: 'k', v: 1 }];
    const { value } = mergeEntityLists(base, [{ key: 'k', v: 2 }], [{ key: 'k', v: 1 }, { key: 'm', v: 0 }], { idKey: 'key' });
    expect(value).toEqual([{ key: 'k', v: 2 }, { key: 'm', v: 0 }]);
  });

  it('merges nested params of the same entity field-wise', () => {
    const base: Fx[] = [{ id: 'A', params: { speed: 1, color: { h: 0, s: 1 } } }];
    const local: Fx[] = [{ id: 'A', params: { speed: 1, color: { h: 120, s: 1 } } }];
    const remote: Fx[] = [{ id: 'A', params: { speed: 3, color: { h: 0, s: 0.5 } } }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual([{ id: 'A', params: { speed: 3, color: { h: 120, s: 0.5 } } }]);
    expect(conflicts).toEqual([]);
  });

  it('merges nested entity lists recursively with the inner entity id', () => {
    type P = { id: string; cats: Array<{ id: string; v: number }> };
    const base: P[] = [{ id: 'p', cats: [{ id: 'c1', v: 0 }] }];
    const local: P[] = [{ id: 'p', cats: [{ id: 'c1', v: 1 }] }];
    const remote: P[] = [{ id: 'p', cats: [{ id: 'c1', v: 2 }, { id: 'c2', v: 0 }] }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual([{ id: 'p', cats: [{ id: 'c1', v: 1 }, { id: 'c2', v: 0 }] }]);
    expect(conflicts).toEqual([
      { entityId: 'c1', path: ['p', 'cats', 'c1', 'v'], base: 0, local: 1, remote: 2, kind: 'modify-modify' },
    ]);
  });

  it('treats arrays of primitives inside an entity atomically', () => {
    const base: Fx[] = [{ id: 'A', tags: ['x'] }];
    const { value, conflicts } = mergeEntityLists(base, [{ id: 'A', tags: ['x', 'l'] }], [{ id: 'A', tags: ['x', 'r'] }]);
    expect(value).toEqual([{ id: 'A', tags: ['x', 'l'] }]);
    expect(conflicts.map(c => c.path)).toEqual([['A', 'tags']]);
  });

  it('falls back to an atomic merge for duplicate ids', () => {
    const base = [{ id: 'a' }];
    const local = [{ id: 'a' }, { id: 'a' }];
    const remote = [{ id: 'b' }];
    const { value, conflicts } = mergeEntityLists(base, local, remote);
    expect(value).toEqual(local);
    expect(conflicts.map(c => c.kind)).toEqual(['modify-modify']);
  });

  it('accepts an undefined base (everything added)', () => {
    const { value } = mergeEntityLists(undefined, [{ id: 'a' }], [{ id: 'b' }]);
    // 'a' has no local predecessor → inserted at the front of remote order.
    expect(value.map(x => x.id)).toEqual(['a', 'b']);
  });

  it('never aliases input entities', () => {
    const remoteB = { id: 'B', params: { s: 1 } };
    const localA = { id: 'A', params: { s: 1 } };
    const { value } = mergeEntityLists([], [localA], [remoteB]);
    expect(value.find(x => x.id === 'A')).not.toBe(localA);
    expect(value.find(x => x.id === 'B')!.params).not.toBe(remoteB.params);
  });
});
