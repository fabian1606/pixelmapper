import { describe, it, expect } from 'vitest';
import type { Fixture } from './core/fixture';
import type { FixtureGroup } from './core/group';
import { fixtureCenterWorld, pointInFootprint, selectedLeafFixtures, swapByCenters } from './swap-positions';

/** Lightweight fake: the helpers only read id, parent, kind and fixturePosition. */
function fx(id: string, x: number, y: number): Fixture {
  return { id, parent: null, kind: null, fixturePosition: { x, y } } as unknown as Fixture;
}

describe('fixtureCenterWorld', () => {
  it('scales the normalized position to world pixels', () => {
    expect(fixtureCenterWorld(fx('a', 0.25, 0.5), 1000, 400)).toEqual({ x: 250, y: 200 });
  });
});

describe('swapByCenters', () => {
  it('exchanges the positions of two regular fixtures', () => {
    const r = swapByCenters(
      { pos: { x: 0.1, y: 0.2 }, center: { x: 100, y: 200 } },
      { pos: { x: 0.7, y: 0.4 }, center: { x: 700, y: 400 } },
      1000, 1000,
    );
    expect(r.a.x).toBeCloseTo(0.7);
    expect(r.a.y).toBeCloseTo(0.4);
    expect(r.b.x).toBeCloseTo(0.1);
    expect(r.b.y).toBeCloseTo(0.2);
  });

  it('swaps visual centers when origin and center differ (kind fixtures)', () => {
    // a's center sits 50px right of its origin; after the swap it must be at b's center.
    const r = swapByCenters(
      { pos: { x: 0.1, y: 0.1 }, center: { x: 150, y: 100 } },
      { pos: { x: 0.5, y: 0.5 }, center: { x: 500, y: 500 } },
      1000, 1000,
    );
    expect(r.a.x * 1000 + 50).toBeCloseTo(500);
    expect(r.b.x * 1000).toBeCloseTo(150);
  });
});

describe('selectedLeafFixtures', () => {
  it('includes fixtures selected directly or through an ancestor group', () => {
    const a = fx('a', 0, 0);
    const b = fx('b', 0, 0);
    const c = fx('c', 0, 0);
    const g = { id: 'g', parent: null, children: [b] } as unknown as FixtureGroup;
    (b as { parent: FixtureGroup | null }).parent = g;
    expect(selectedLeafFixtures([a, b, c], new Set(['a', 'g'])).map(f => f.id)).toEqual(['a', 'b']);
  });
});

describe('pointInFootprint', () => {
  const center = { x: 100, y: 100 };

  it('hits inside and misses outside an axis-aligned box', () => {
    const fp = { halfW: 20, halfH: 10, rotation: 0 };
    expect(pointInFootprint({ x: 115, y: 105 }, center, fp)).toBe(true);
    expect(pointInFootprint({ x: 100, y: 115 }, center, fp)).toBe(false);
  });

  it('honors rotation and padding', () => {
    const fp = { halfW: 20, halfH: 10, rotation: 90 };
    // Rotated 90°: the long side now runs vertically.
    expect(pointInFootprint({ x: 100, y: 115 }, center, fp)).toBe(true);
    expect(pointInFootprint({ x: 115, y: 100 }, center, fp)).toBe(false);
    expect(pointInFootprint({ x: 115, y: 100 }, center, fp, 6)).toBe(true);
  });
});
