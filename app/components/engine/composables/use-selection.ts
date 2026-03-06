import { ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import type { SceneNode } from '~/utils/engine/core/group';

export type Interaction =
  | { type: 'idle' }
  | { type: 'marquee'; start: Point; end: Point }
  | { type: 'drag'; startWorld: Point; startPositions: Map<string | number, Point> };

const DOT_SPACING = 25;

function snapWorld(px: number): number {
  return Math.round(px / DOT_SPACING) * DOT_SPACING;
}

function toNormalized(px: number, max: number): number {
  return px / max;
}

/**
 * Manages multi-selection (marquee + shift-click) and group drag logic.
 *
 * @param getFixtures       Getter for the fixtures array.
 * @param getWidth          Getter for the world width in pixels.
 * @param getHeight         Getter for the world height in pixels.
 * @param toWorld           Converts viewport-space x/y to world-space (from useCamera).
 * @param onDragComplete    Called at drag end with before/after snapshots for history.
 */
export function useSelection(
  getFixtures: () => Fixture[],
  getWidth: () => number,
  getHeight: () => number,
  toWorld: (vx: number, vy: number) => Point,
  onDragComplete?: (before: FixturePositionSnapshot[], after: FixturePositionSnapshot[]) => void,
  externalSelectedIds?: import('vue').Ref<Set<string | number>>
) {
  const selectedIds = externalSelectedIds ?? ref<Set<string | number>>(new Set());
  const interaction = ref<Interaction>({ type: 'idle' });

  let lastClickId: string | number | null = null;
  let lastClickTime = 0;

  // Captures positions at drag-start so we can build an undo-able command later
  let beforeSnapshot: FixturePositionSnapshot[] = [];

  function onViewportMouseDown(event: MouseEvent, rect: DOMRect) {
    if (event.button === 2) return; // ignore right click
    if ((event.target as HTMLElement).closest('.fixture-node')) return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (!event.shiftKey) selectedIds.value = new Set();
    interaction.value = { type: 'marquee', start: { ...world }, end: { ...world } };
  }

  function onDragStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    const now = performance.now();
    const isDoubleClick = (lastClickId === fixture.id && now - lastClickTime < 300);
    lastClickId = fixture.id;
    lastClickTime = now;

    const path: SceneNode[] = [];
    let curr: SceneNode | null = fixture as unknown as SceneNode;
    while (curr) {
      path.unshift(curr);
      curr = curr.parent;
    }

    let targetNode = path[0];
    if (!targetNode) return;

    const selectedIndex = path.findIndex(n => selectedIds.value.has(n.id));

    if (selectedIndex !== -1) {
      if (isDoubleClick && selectedIndex < path.length - 1) {
        targetNode = path[selectedIndex + 1] as SceneNode;
        lastClickId = null; // reset to avoid triple click jump
      } else {
        targetNode = path[selectedIndex] as SceneNode;
      }
    }

    if (!targetNode) return;

    // ── Compute the effective selection locally ────────────────────────────────
    // We must NOT re-read selectedIds.value after writing to it: since selectedIds
    // is backed by a defineModel customRef, the write enqueues a parent emit but
    // the local value may still be stale on the very next synchronous read.
    // Using a plain local Set guarantees startPositions reflects the NEW selection.
    let effectiveSelectedIds: Set<string | number>;

    if (event.shiftKey) {
      const next = new Set(selectedIds.value);
      next.has(targetNode.id) ? next.delete(targetNode.id) : next.add(targetNode.id);
      effectiveSelectedIds = next;
    } else if (!selectedIds.value.has(targetNode.id)) {
      // Fixture is not yet selected — switch selection to it
      effectiveSelectedIds = new Set([targetNode.id]);
    } else {
      // Already selected — keep current selection (multi-drag)
      effectiveSelectedIds = new Set(selectedIds.value);
    }

    // Propagate to the model ref (notifies parent + canvas)
    selectedIds.value = effectiveSelectedIds;

    if (event.button === 2) return; // ignore right click for dragging, but allow it to update selection

    const startPositions = new Map<string | number, Point>();
    const w = getWidth();
    const h = getHeight();

    // Capture BEFORE positions for undo history — use effectiveSelectedIds so
    // we always capture the NEWLY selected fixtures, not a potentially stale read.
    beforeSnapshot = [];
    for (const f of getFixtures()) {
      let isSelected = false;
      let c: SceneNode | null = f as unknown as SceneNode;
      while (c) {
        if (effectiveSelectedIds.has(c.id)) { isSelected = true; break; }
        c = c.parent;
      }

      if (isSelected) {
        startPositions.set(f.id, { x: f.fixturePosition.x * w, y: f.fixturePosition.y * h });
        beforeSnapshot.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y });
      }
    }
    interaction.value = { type: 'drag', startWorld: world, startPositions };
  }

  function onMouseMove(event: MouseEvent, rect: DOMRect) {
    const iv = interaction.value;
    if (iv.type === 'idle') return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    if (iv.type === 'marquee') {
      interaction.value = { ...iv, end: world };
    } else if (iv.type === 'drag') {
      const dx = world.x - iv.startWorld.x;
      const dy = world.y - iv.startWorld.y;
      const w = getWidth();
      const h = getHeight();
      for (const f of getFixtures()) {
        const start = iv.startPositions.get(f.id);
        if (start) {
          f.fixturePosition.x = toNormalized(snapWorld(start.x + dx), w);
          f.fixturePosition.y = toNormalized(snapWorld(start.y + dy), h);
        }
      }
    }
  }

  function onMouseUp() {
    const iv = interaction.value;

    if (iv.type === 'marquee') {
      const minX = Math.min(iv.start.x, iv.end.x);
      const maxX = Math.max(iv.start.x, iv.end.x);
      const minY = Math.min(iv.start.y, iv.end.y);
      const maxY = Math.max(iv.start.y, iv.end.y);
      const hit = new Set<string | number>();
      const w = getWidth();
      const h = getHeight();
      for (const f of getFixtures()) {
        const wx = f.fixturePosition.x * w;
        const wy = f.fixturePosition.y * h;
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
          const path: SceneNode[] = [];
          let curr: SceneNode | null = f as unknown as SceneNode;
          while (curr) { path.unshift(curr); curr = curr.parent; }
          if (path[0]) hit.add(path[0].id);
        }
      }
      selectedIds.value = hit;
    } else if (iv.type === 'drag' && beforeSnapshot.length > 0 && onDragComplete) {
      // Capture AFTER positions and notify parent for history recording
      const afterSnapshot: FixturePositionSnapshot[] = beforeSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return {
          id: snap.id,
          x: f ? f.fixturePosition.x : snap.x,
          y: f ? f.fixturePosition.y : snap.y
        };
      });

      // Only record if something actually moved
      const didMove = beforeSnapshot.some(
        (b, i) => {
          const after = afterSnapshot[i];
          return after && (b.x !== after.x || b.y !== after.y);
        }
      );
      if (didMove) onDragComplete(beforeSnapshot, afterSnapshot);
      beforeSnapshot = [];
    }

    interaction.value = { type: 'idle' };
  }

  return { selectedIds, interaction, onViewportMouseDown, onDragStart, onMouseMove, onMouseUp };
}
