import type { SceneNode } from './core/group';

/**
 * Shared selection-interpretation rules for the 2D editor and 3D viewport.
 * Both canvases must resolve "given this click/gesture and the current
 * selection, which SceneNode ends up selected?" the exact same way — this
 * module is the single place that logic lives, so the two views can't drift
 * apart again. Kept framework-agnostic (no Vue/DOM/Three imports) so it's
 * usable from a Vue composable and from the plain-TS `ThreeSceneManager`.
 */

/** Ctrl/Cmd = toggle/multi-select. Shift is reserved for the line-select gesture. */
export function isAdditiveModifier(mods: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return mods.ctrlKey || mods.metaKey;
}

/** Walks `.parent` links from `node` up to the root, root-first. */
export function buildAncestorPath(node: SceneNode): SceneNode[] {
  const path: SceneNode[] = [];
  let curr: SceneNode | null = node;
  while (curr) { path.unshift(curr); curr = curr.parent; }
  return path;
}

/**
 * Finds the deepest level of `path` (root first) that is "in context" with
 * the current selection — either that node itself is selected, or one of its
 * siblings (same parent) is selected. This lets an additive click on another
 * member of a group you've already drilled into select that member directly,
 * instead of jumping back up to selecting the whole group.
 */
export function resolveSelectionDepth(path: SceneNode[], selected: Set<string | number>): number {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]!;
    if (selected.has(node.id)) return i;
    const parent = node.parent;
    if (parent && parent.children.some(c => selected.has(c.id))) return i;
  }
  return -1;
}

/**
 * The full result of a click/tap on `path` (the clicked node's ancestor chain,
 * root first) given the current selection. Resolves which node the click
 * targets *and* the resulting selection set, so the 2D and 3D canvases behave
 * identically. Rules:
 *
 * - Target defaults to the outermost group (`path[0]`), or the node "in
 *   context" with the current selection (see `resolveSelectionDepth`).
 * - A double-click drills one level deeper into the in-context node — in
 *   *additive* mode too, so `Cmd`+double-click can pull an individual fixture
 *   out of a *different* group into a cross-group multi-selection.
 * - Additive (Ctrl/Cmd) toggles the target in/out; a *drill* in additive mode
 *   swaps the group it drilled out of for the deeper node, keeping the rest of
 *   the selection intact.
 * - A plain click replaces the selection with just the target, unless the
 *   target was already selected (then the set is kept, so dragging an existing
 *   multi-selection doesn't collapse it).
 */
export function resolveClickSelection(
  path: SceneNode[],
  selected: Set<string | number>,
  isDoubleClick: boolean,
  additive: boolean,
): { targetNode: SceneNode; nextSelected: Set<string | number>; wasAlreadySelected: boolean; drilled: boolean } {
  const selectedIndex = resolveSelectionDepth(path, selected);
  let targetIndex = selectedIndex === -1 ? 0 : selectedIndex;
  let drilledFromId: string | number | null = null;
  if (isDoubleClick && selectedIndex !== -1 && selectedIndex < path.length - 1) {
    drilledFromId = path[selectedIndex]!.id;
    targetIndex = selectedIndex + 1;
  }
  const targetNode = path[targetIndex]!;
  const drilled = drilledFromId !== null;
  const wasAlreadySelected = selected.has(targetNode.id);

  let nextSelected: Set<string | number>;
  if (additive) {
    nextSelected = new Set(selected);
    if (drilled) {
      nextSelected.delete(drilledFromId!);
      nextSelected.add(targetNode.id);
    } else if (nextSelected.has(targetNode.id)) {
      nextSelected.delete(targetNode.id);
    } else {
      nextSelected.add(targetNode.id);
    }
  } else if (drilled || !wasAlreadySelected) {
    nextSelected = new Set([targetNode.id]);
  } else {
    nextSelected = new Set(selected);
  }
  return { targetNode, nextSelected, wasAlreadySelected, drilled };
}

/** Tracks whether consecutive clicks on the same id land within a double-click window. */
export function createDoubleClickTracker(windowMs = 300) {
  let lastId: string | number | null = null;
  let lastTime = 0;
  return {
    /** Call on every click; returns true if this click is a double-click on the same id as the last one. */
    check(id: string | number, now: number): boolean {
      const isDouble = lastId === id && now - lastTime < windowMs;
      lastId = id;
      lastTime = now;
      return isDouble;
    },
    /** Forces the next click to not be read as a double-click continuation (e.g. after drilling). */
    reset(): void {
      lastId = null;
    },
  };
}

/** Screen-space pickup radius for the line-select tool, in CSS pixels. */
export const LINE_SELECT_PICKUP_PX = 18;

/** Below this screen-pixel movement, a Shift gesture is a click (range-select) rather than a drag (line-select). */
export const CLICK_MOVE_THRESHOLD_PX = 5;

/** Shortest distance from point (px,py) to the segment a→b. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment (click without drag) → distance to the point.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
