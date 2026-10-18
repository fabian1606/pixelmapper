// Content hash + save dedupe for server autosaves (migration 013, client side).
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createSnapshotSaveDedupe,
  normalizeSnapshotContent,
  snapshotContentHash,
} from './snapshot-content-hash';

/** Snapshot with a nested group tree. */
function snapshot(over: Record<string, unknown> = {}, expanded = true) {
  return {
    clockEpoch: 1000,
    globalBpm: 120,
    sceneNodes: [
      {
        _type: 'group', id: 'g1', name: 'Truss', expanded,
        children: [
          { _type: 'fixture', id: 'f1', name: 'Par', expanded: true },
          { id: 'g2', expanded: !expanded, children: [] },
        ],
      },
      { _type: 'group', id: 'g3', expanded },
    ],
    modifiers: [],
    ...over,
  };
}

describe('normalizeSnapshotContent', () => {
  it('drops clockEpoch and group expanded flags at any depth, not fixture flags', () => {
    expect(normalizeSnapshotContent(snapshot())).toEqual({
      globalBpm: 120,
      sceneNodes: [
        { _type: 'group', id: 'g1', name: 'Truss', children: [
          { _type: 'fixture', id: 'f1', name: 'Par', expanded: true },
          { id: 'g2', children: [] },
        ] },
        { _type: 'group', id: 'g3' },
      ],
      modifiers: [],
    });
  });

  it('does not mutate the input and passes malformed input through', () => {
    const s = snapshot();
    normalizeSnapshotContent(s);
    expect(s.clockEpoch).toBe(1000);
    expect(s.sceneNodes[0]).toHaveProperty('expanded', true);
    expect(normalizeSnapshotContent(null)).toBeNull();
    expect(normalizeSnapshotContent({ sceneNodes: 5 })).toEqual({ sceneNodes: 5 });
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined like JSON.stringify', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: undefined, x: 2 }], c: null } }))
      .toBe('{"a":{"c":null,"d":[{"x":2,"z":1}]},"b":1}');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('snapshotContentHash', () => {
  it('ignores the volatile fields and key order', async () => {
    const a = await snapshotContentHash(snapshot());
    const b = await snapshotContentHash({ ...snapshot({ clockEpoch: 5 }, false) });
    const reordered = await snapshotContentHash({ modifiers: [], sceneNodes: snapshot().sceneNodes, globalBpm: 120 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(reordered).toBe(a);
  });

  it('changes with real content', async () => {
    const a = await snapshotContentHash(snapshot());
    expect(await snapshotContentHash(snapshot({ globalBpm: 121 }))).not.toBe(a);
    const fixtureFlag = snapshot();
    (fixtureFlag.sceneNodes[0] as { children: Array<Record<string, unknown>> }).children[0]!.expanded = false;
    expect(await snapshotContentHash(fixtureFlag)).not.toBe(a);
  });
});

describe('createSnapshotSaveDedupe', () => {
  it('never skips before the first save, then skips unchanged content only', async () => {
    const dedupe = createSnapshotSaveDedupe();
    const first = await dedupe.check(snapshot());
    expect(first.unchanged).toBe(false);
    dedupe.saved(first.hash);
    expect((await dedupe.check(snapshot({ clockEpoch: 2 }, false))).unchanged).toBe(true);
    const changed = await dedupe.check(snapshot({ globalBpm: 90 }));
    expect(changed.unchanged).toBe(false);
  });

  it('a failed save (no saved() call) does not suppress the retry', async () => {
    const dedupe = createSnapshotSaveDedupe();
    dedupe.saved((await dedupe.check(snapshot())).hash);
    const next = await dedupe.check(snapshot({ globalBpm: 90 }));
    // save failed → saved() not called
    expect((await dedupe.check(snapshot({ globalBpm: 90 }))).unchanged).toBe(false);
    dedupe.saved(next.hash);
    expect((await dedupe.check(snapshot({ globalBpm: 90 }))).unchanged).toBe(true);
  });

  it('never skips when hashing fails', async () => {
    const dedupe = createSnapshotSaveDedupe();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const r = await dedupe.check(cyclic);
    expect(r).toEqual({ hash: '', unchanged: false });
    dedupe.saved(r.hash);
    expect((await dedupe.check(cyclic)).unchanged).toBe(false);
  });
});
