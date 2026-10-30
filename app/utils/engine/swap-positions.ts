import type { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { kindWorldAabb } from '~/utils/kinds/kind-host';
import { FIXTURE_RADIUS } from '~/utils/engine/constants';

// ── Figma-style position swap ────────────────────────────────────────────────
// Pure helpers behind the swap handles of a multi-selection: every selected
// fixture shows a dot at its visual center. Dragging a dot drags the fixture;
// hovering another fixture's original place moves that one into the dragged
// fixture's original place and shows a ghost where the dragged one will land.

/** Point in world pixels. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Visual center of a fixture in world pixels. Regular fixtures are drawn
 * centered on `fixturePosition`; kind fixtures (curves, shapes) are placed by
 * their origin, so their visual center is the AABB center of the geometry.
 */
export function fixtureCenterWorld(f: Fixture, worldWidth: number, worldHeight: number): WorldPoint {
  const box = f.kind ? kindWorldAabb(f) : null;
  if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return { x: f.fixturePosition.x * worldWidth, y: f.fixturePosition.y * worldHeight };
}

/** A fixture's resting placement: normalized origin + visual center in world px. */
export interface SwapAnchor {
  /** Normalized `fixturePosition` (0–1). */
  pos: WorldPoint;
  /** Visual center in world pixels. */
  center: WorldPoint;
}

/**
 * Positions that swap the visual centers of `a` and `b`. Each fixture is
 * shifted by the center delta (not assigned the other's origin) so kind
 * fixtures whose origin ≠ center land exactly where the other one was drawn.
 * For regular fixtures this is a plain position swap. Only x/y — height (z)
 * and rotation are left untouched.
 */
export function swapByCenters(
  a: SwapAnchor,
  b: SwapAnchor,
  worldWidth: number,
  worldHeight: number,
): { a: WorldPoint; b: WorldPoint } {
  const dx = (b.center.x - a.center.x) / worldWidth;
  const dy = (b.center.y - a.center.y) / worldHeight;
  return {
    a: { x: a.pos.x + dx, y: a.pos.y + dy },
    b: { x: b.pos.x - dx, y: b.pos.y - dy },
  };
}

/** Outline of a fixture in world px — what the ghost preview draws. */
export interface FixtureFootprint {
  /** Half extents in world pixels. */
  halfW: number;
  halfH: number;
  /** Rotation in degrees around the visual center. */
  rotation: number;
}

/**
 * Footprint matching the canvas selection outline: regular fixtures are a
 * rotated box of `fixtureSize × FIXTURE_RADIUS`; kind fixtures use their
 * axis-aligned geometry bounds (min 8px half extent, like the canvas).
 */
export function fixtureFootprint(f: Fixture): FixtureFootprint {
  const box = f.kind ? kindWorldAabb(f) : null;
  if (box) {
    return {
      halfW: Math.max((box.maxX - box.minX) / 2, 8),
      halfH: Math.max((box.maxY - box.minY) / 2, 8),
      rotation: 0,
    };
  }
  return {
    halfW: (f.fixtureSize?.x ?? 1) * FIXTURE_RADIUS,
    halfH: (f.fixtureSize?.y ?? 1) * FIXTURE_RADIUS,
    rotation: f.rotation || 0,
  };
}

/**
 * True when world point `p` lies inside a footprint centered at `center`
 * (rotation honored), grown by `pad` world px on every side so tiny fixtures
 * stay hoverable. Used for the swap hover zones, which stay at the fixtures'
 * pre-drag places even when the fixtures themselves move.
 */
export function pointInFootprint(p: WorldPoint, center: WorldPoint, fp: FixtureFootprint, pad = 0): boolean {
  const rad = (-fp.rotation * Math.PI) / 180;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  // Rotate the point into the footprint's local, axis-aligned frame.
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= fp.halfW + pad && Math.abs(ly) <= fp.halfH + pad;
}

/**
 * Leaf fixtures covered by a selection — a fixture counts when it or any
 * ancestor group is selected (same rule the canvas uses for highlighting).
 */
export function selectedLeafFixtures(fixtures: Fixture[], selectedIds: Set<string | number>): Fixture[] {
  return fixtures.filter((f) => {
    let c: SceneNode | null = f as unknown as SceneNode;
    while (c) {
      if (selectedIds.has(c.id)) return true;
      c = c.parent;
    }
    return false;
  });
}
