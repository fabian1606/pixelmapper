// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rebaseChange } from '../index';
import { makeState, mod } from './test-state';

/** Tests of the modifier rebase adapters (SetModifiers, modifier.sync, modifier.update). */

describe('SetModifiers', () => {
  it('key scenario: offline speed edit on A + online add of B → both survive', () => {
    const A = mod('A', { speed: 1 });
    const payload = { before: [A], after: [mod('A', { speed: 4 })] };
    const current = makeState({ modifiers: [mod('A', { speed: 1 }), mod('B', { speed: 2 })] });
    const res = rebaseChange({ type: 'SetModifiers', payload }, current);
    expect(res.skipped).toBeUndefined();
    expect(res.conflicts).toEqual([]);
    expect(res.payload).toEqual({
      before: current.modifiers,
      after: [mod('A', { speed: 4 }), mod('B', { speed: 2 })],
    });
  });

  it('same param edited on both sides → local wins + conflict', () => {
    const payload = { before: [mod('A', { speed: 1 })], after: [mod('A', { speed: 4 })] };
    const current = makeState({ modifiers: [mod('A', { speed: 9 })] });
    const res = rebaseChange({ type: 'SetModifiers', payload }, current);
    expect((res.payload as any).after).toEqual([mod('A', { speed: 4 })]);
    expect(res.conflicts).toEqual([
      { entityId: 'A', path: ['A', 'params', 'speed'], base: 1, local: 4, remote: 9, kind: 'modify-modify' },
    ]);
  });

  it('local delete of a modifier edited remotely → kept, remove-modify conflict', () => {
    const payload = { before: [mod('A'), mod('B', { s: 1 })], after: [mod('A')] };
    const current = makeState({ modifiers: [mod('A'), mod('B', { s: 2 })] });
    const res = rebaseChange({ type: 'SetModifiers', payload }, current);
    expect((res.payload as any).after).toEqual([mod('A'), mod('B', { s: 2 })]);
    expect(res.conflicts.map(c => c.kind)).toEqual(['remove-modify']);
  });

  it('local reorder survives a remote param edit', () => {
    const payload = { before: [mod('A'), mod('B')], after: [mod('B'), mod('A')] };
    const current = makeState({ modifiers: [mod('A', { x: 1 }), mod('B')] });
    const res = rebaseChange({ type: 'SetModifiers', payload }, current);
    expect((res.payload as any).after).toEqual([mod('B'), mod('A', { x: 1 })]);
  });

  it('does not alias the current state', () => {
    const current = makeState({ modifiers: [mod('A', { s: 1 })] });
    const res = rebaseChange({ type: 'SetModifiers', payload: { before: [], after: [] } }, current);
    const out = res.payload as any;
    out.before[0].params.s = 99;
    expect((current.modifiers[0] as any).params.s).toBe(1);
  });
});

describe('modifier.sync', () => {
  it('with previous: full 3-way merge keeps remote additions and local deletions', () => {
    const previous = makeState({ modifiers: [mod('A'), mod('X')] });
    const current = makeState({ modifiers: [mod('A'), mod('X'), mod('B')] });
    const res = rebaseChange({ type: 'modifier.sync', payload: { modifiers: [mod('A', { s: 3 })] } }, current, previous);
    expect(res.payload).toEqual({ modifiers: [mod('A', { s: 3 }), mod('B')] });
    expect(res.conflicts).toEqual([]);
  });

  it('without previous: remote-only modifiers survive', () => {
    const current = makeState({ modifiers: [mod('A'), mod('B')] });
    const res = rebaseChange({ type: 'modifier.sync', payload: { modifiers: [mod('A')] } }, current);
    expect((res.payload as any).modifiers.map((m: any) => m.id)).toEqual(['A', 'B']);
  });
});

describe('modifier.update', () => {
  const payload = { effectId: 'A', changes: { strength: 0.5 }, paramChanges: { speed: 3 } };

  it('passes through while the modifier exists', () => {
    const res = rebaseChange({ type: 'modifier.update', payload }, makeState({ modifiers: [mod('A')] }));
    expect(res).toEqual({ payload, conflicts: [] });
  });

  it('skips when the modifier was deleted remotely', () => {
    const res = rebaseChange({ type: 'modifier.update', payload }, makeState({ modifiers: [mod('B')] }));
    expect(res.skipped).toMatch(/A/);
  });

  it('reports a remote edit of the same param when previous is known', () => {
    const previous = makeState({ modifiers: [mod('A', { speed: 1 })] });
    const current = makeState({ modifiers: [mod('A', { speed: 7 })] });
    const res = rebaseChange({ type: 'modifier.update', payload }, current, previous);
    expect(res.conflicts).toEqual([
      { entityId: 'A', path: ['A', 'params', 'speed'], base: 1, local: 3, remote: 7, kind: 'modify-modify' },
    ]);
  });
});
