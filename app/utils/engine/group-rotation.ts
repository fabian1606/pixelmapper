import type { Fixture } from './core/fixture';
import type { SceneNode } from './core/group';

/**
 * Rotation semantics for a selection that may contain groups.
 *
 * A selected group rotates as one rigid unit: every member fixture spins by
 * the delta AND orbits the group's center, so the group's layout turns with
 * it. A fixture selected on its own (including a drilled-into group member)
 * only spins around its own center, as before.
 *
 * All math runs in normalized stage space (0–1). The 2D world and the 3D
 * stage are both square, so that space is isotropic and a plain 2D rotation
 * is correct. Positive degrees match `Fixture.rotation` (clockwise on the
 * y-down canvas).
 */

/** Pivot in normalized stage space. */
export interface RotationPivot {
  x: number;
  y: number;
}

/** One fixture's start state for a rotation gesture. */
export interface RotationTarget {
  id: string | number;
  x: number;
  y: number;
  rotation: number;
  /** Center of the selected group this fixture belongs to; null → spins in place. */
  pivot: RotationPivot | null;
}

/**
 * Outermost selected node on `fixture`'s ancestor chain (the fixture itself
 * included), or null when neither it nor any ancestor is selected.
 */
function outermostSelected(fixture: Fixture, selectedIds: Set<string | number>): SceneNode | null {
  let found: SceneNode | null = null;
  let node: SceneNode | null = fixture as unknown as SceneNode;
  while (node) {
    if (selectedIds.has(node.id)) found = node;
    node = node.parent;
  }
  return found;
}

/**
 * Collects the start state of every fixture affected by rotating the current
 * selection, with each group member carrying its group's pivot (center of the
 * members' bounding box).
 */
export function collectRotationTargets(fixtures: Fixture[], selectedIds: Set<string | number>): RotationTarget[] {
  const targets: RotationTarget[] = [];
  // Group id → indices into `targets`, to assign the pivot once bounds are known.
  const groupMembers = new Map<string | number, number[]>();

  for (const f of fixtures) {
    const unit = outermostSelected(f, selectedIds);
    if (!unit) continue;
    targets.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, rotation: f.rotation || 0, pivot: null });
    if (unit.id === f.id) continue;
    const members = groupMembers.get(unit.id) ?? [];
    members.push(targets.length - 1);
    groupMembers.set(unit.id, members);
  }

  for (const members of groupMembers.values()) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of members) {
      const t = targets[i]!;
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    const pivot = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    for (const i of members) targets[i]!.pivot = pivot;
  }
  return targets;
}

/** Wraps degrees into [0, 360). */
export function wrapDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Rotates point (x, y) around `pivot` by `deg` degrees. */
export function orbitPoint(x: number, y: number, pivot: RotationPivot, deg: number): RotationPivot {
  const rad = deg * (Math.PI / 180);
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = x - pivot.x, dy = y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

/**
 * Applies `deltaDeg` to `fixture` relative to its start state `target`:
 * always spins it, and orbits it around its group pivot when it has one.
 */
export function applyRotationDelta(fixture: Fixture, target: RotationTarget, deltaDeg: number): void {
  fixture.rotation = wrapDegrees(target.rotation + deltaDeg);
  if (!target.pivot) return;
  const p = orbitPoint(target.x, target.y, target.pivot, deltaDeg);
  fixture.fixturePosition.x = p.x;
  fixture.fixturePosition.y = p.y;
}
