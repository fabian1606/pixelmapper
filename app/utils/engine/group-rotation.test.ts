import { describe, it, expect } from 'vitest';
import type { Fixture } from './core/fixture';
import { applyRotationDelta, collectRotationTargets, orbitPoint } from './group-rotation';

/** Lightweight fake: the helpers only read id, parent, rotation and fixturePosition. */
function fx(id: string, x: number, y: number, parent: unknown = null, rotation = 0): Fixture {
  return { id, parent, rotation, fixturePosition: { x, y } } as unknown as Fixture;
}

describe('orbitPoint', () => {
  it('turns +90° clockwise on the y-down canvas', () => {
    const p = orbitPoint(0.6, 0.5, { x: 0.5, y: 0.5 }, 90);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.6);
  });
});

describe('collectRotationTargets', () => {
  it('gives members of a selected group the group center as pivot', () => {
    const group = { id: 'g', parent: null };
    const a = fx('a', 0.2, 0.4, group);
    const b = fx('b', 0.6, 0.6, group);
    const targets = collectRotationTargets([a, b], new Set(['g']));
    expect(targets.map(t => t.pivot)).toEqual([{ x: 0.4, y: 0.5 }, { x: 0.4, y: 0.5 }]);
  });

  it('lets individually selected group members spin in place', () => {
    const group = { id: 'g', parent: null };
    const a = fx('a', 0.2, 0.4, group);
    const b = fx('b', 0.6, 0.6, group);
    const targets = collectRotationTargets([a, b], new Set(['a', 'b']));
    expect(targets.map(t => t.pivot)).toEqual([null, null]);
  });

  it('uses the outermost selected group for nested groups and skips unselected fixtures', () => {
    const outer = { id: 'o', parent: null };
    const inner = { id: 'i', parent: outer };
    const a = fx('a', 0, 0, inner);
    const b = fx('b', 1, 1, outer);
    const c = fx('c', 0.5, 0.5);
    const targets = collectRotationTargets([a, b, c], new Set(['o', 'i']));
    expect(targets.map(t => t.id)).toEqual(['a', 'b']);
    expect(targets[0]!.pivot).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('applyRotationDelta', () => {
  it('spins and orbits a group member, keeping the layout rigid', () => {
    const group = { id: 'g', parent: null };
    const a = fx('a', 0.4, 0.5, group, 10);
    const b = fx('b', 0.6, 0.5, group, 350);
    const targets = collectRotationTargets([a, b], new Set(['g']));
    applyRotationDelta(a, targets[0]!, 90);
    applyRotationDelta(b, targets[1]!, 90);
    expect(a.rotation).toBe(100);
    expect(b.rotation).toBe(80);
    expect(a.fixturePosition.x).toBeCloseTo(0.5);
    expect(a.fixturePosition.y).toBeCloseTo(0.4);
    expect(b.fixturePosition.x).toBeCloseTo(0.5);
    expect(b.fixturePosition.y).toBeCloseTo(0.6);
  });

  it('leaves the position of a standalone fixture untouched', () => {
    const a = fx('a', 0.3, 0.7);
    const [t] = collectRotationTargets([a], new Set(['a']));
    applyRotationDelta(a, t!, 45);
    expect(a.rotation).toBe(45);
    expect(a.fixturePosition).toEqual({ x: 0.3, y: 0.7 });
  });
});
