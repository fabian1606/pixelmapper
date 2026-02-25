import { ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';

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
) {
  const selectedIds = ref<Set<string | number>>(new Set());
  const interaction = ref<Interaction>({ type: 'idle' });

  // Captures positions at drag-start so we can build an undo-able command later
  let beforeSnapshot: FixturePositionSnapshot[] = [];

  function onViewportMouseDown(event: MouseEvent, rect: DOMRect) {
    if ((event.target as HTMLElement).closest('.fixture-node')) return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (!event.shiftKey) selectedIds.value = new Set();
    interaction.value = { type: 'marquee', start: { ...world }, end: { ...world } };
  }

  function onDragStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    if (event.shiftKey) {
      const next = new Set(selectedIds.value);
      next.has(fixture.id) ? next.delete(fixture.id) : next.add(fixture.id);
      selectedIds.value = next;
    } else if (!selectedIds.value.has(fixture.id)) {
      selectedIds.value = new Set([fixture.id]);
    }

    const startPositions = new Map<string | number, Point>();
    const w = getWidth();
    const h = getHeight();

    // Capture BEFORE positions for undo history
    beforeSnapshot = [];
    for (const f of getFixtures()) {
      if (selectedIds.value.has(f.id)) {
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
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) hit.add(f.id);
      }
      selectedIds.value = hit;
    } else if (iv.type === 'drag' && beforeSnapshot.length > 0 && onDragComplete) {
      // Capture AFTER positions and notify parent for history recording
      const afterSnapshot: FixturePositionSnapshot[] = beforeSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return { id: snap.id, x: f?.fixturePosition.x ?? snap.x, y: f?.fixturePosition.y ?? snap.y };
      });

      // Only record if something actually moved
      const didMove = beforeSnapshot.some(
        (b, i) => b.x !== afterSnapshot.at(i)?.x || b.y !== afterSnapshot.at(i)?.y,
      );
      if (didMove) onDragComplete(beforeSnapshot, afterSnapshot);
      beforeSnapshot = [];
    }

    interaction.value = { type: 'idle' };
  }

  return { selectedIds, interaction, onViewportMouseDown, onDragStart, onMouseMove, onMouseUp };
}
