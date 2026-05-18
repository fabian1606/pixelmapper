import { ref } from 'vue';
import type { Fixture, StripPoint } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import type { SceneNode } from '~/utils/engine/core/group';
import type { FixtureRotationSnapshot } from '../commands/rotate-fixture-command';
import type { StripPointsSnapshot } from '../commands/reshape-strip-command';
import { syncStripBounds } from '~/utils/engine/neopixel-strip-factory';

export type Interaction =
  | { type: 'idle' }
  | { type: 'marquee'; start: Point; end: Point }
  | {
      type: 'drag';
      startWorld: Point;
      /** Pre-drag fixturePosition in world-pixels — for non-strip selected fixtures. */
      startPositions: Map<string | number, Point>;
      /** Pre-drag polyline snapshot — for strip selected fixtures. */
      startStripPoints: Map<string | number, StripPoint[]>;
    }
  | { type: 'rotate'; startWorld: Point; startAngles: Map<string | number, number>; centerWorld: Point }
  | {
      /** Drag a single polyline vertex of a strip freely in world space. */
      type: 'strip-vertex';
      fixtureId: string | number;
      vertexIndex: number;
      /** Pre-drag deep copy of the strip's points for the undo command. */
      startPoints: StripPoint[];
    };

export interface CanvasHitTester {
  hitTest: (x: number, y: number) => string | undefined;
  hitTestRotationZone: (x: number, y: number) => string | undefined;
  /**
   * Returns one of:
   *   "<fixtureId>:vertex:<idx>"  → vertex handle hit (drag to move)
   *   "<fixtureId>:mid:<idx>"     → mid-segment handle hit (click to insert vertex)
   */
  hitTestStripEndpoint?: (x: number, y: number) => string | undefined;
}

const DOT_SPACING = 25;

function snapWorld(px: number): number {
  return Math.round(px / DOT_SPACING) * DOT_SPACING;
}

function toNormalized(px: number, max: number): number {
  return px / max;
}

function clonePoints(pts: StripPoint[]): StripPoint[] {
  return pts.map(p => ({ x: p.x, y: p.y }));
}

export function useSelection(
  getFixtures: () => Fixture[],
  getWidth: () => number,
  getHeight: () => number,
  toWorld: (vx: number, vy: number) => Point,
  onDragComplete?: (before: FixturePositionSnapshot[], after: FixturePositionSnapshot[]) => void,
  onRotateComplete?: (before: FixtureRotationSnapshot[], after: FixtureRotationSnapshot[]) => void,
  externalSelectedIds?: import('vue').Ref<Set<string | number>>,
  getCanvas?: () => CanvasHitTester | null,
  onReshapeStrip?: (before: StripPointsSnapshot, after: StripPointsSnapshot) => void,
) {
  const selectedIds = externalSelectedIds ?? ref<Set<string | number>>(new Set());
  const interaction = ref<Interaction>({ type: 'idle' });
  /**
   * Id of the strip currently in "edit mode" — at most one at a time.
   * Set when the user clicks an already-selected strip; cleared whenever the
   * selection changes to a different/no fixture. Vertex/mid-handles are only
   * rendered + hit-tested for the editing strip.
   */
  const editingId = ref<string | number | null>(null);
  /**
   * The currently focused vertex inside the editing strip — set when the user
   * clicks a vertex handle, and consumed by `deleteEditingVertex()` to remove
   * that vertex via keyboard (Delete / Backspace). Cleared whenever the
   * editing strip changes or the user clicks outside it.
   */
  const editingVertex = ref<{ fixtureId: string | number; idx: number } | null>(null);

  let lastClickId: string | number | null = null;
  let lastClickTime = 0;
  let beforeSnapshot: FixturePositionSnapshot[] = [];
  let beforeRotationSnapshot: FixtureRotationSnapshot[] = [];
  /** Pre-drag strip-points snapshots, keyed by fixture id — populated alongside `beforeSnapshot` for selected strip fixtures. */
  let beforeStripSnapshots: StripPointsSnapshot[] = [];

  function onViewportMouseDown(event: MouseEvent, rect: DOMRect) {
    if (event.button === 2) {
      const vx = event.clientX - rect.left;
      const vy = event.clientY - rect.top;
      const hitId = getCanvas?.()?.hitTest(vx, vy);
      if (hitId) {
        const fixture = getFixtures().find(f => String(f.id) === hitId);
        if (fixture && !selectedIds.value.has(fixture.id)) {
          selectedIds.value = new Set([fixture.id]);
        }
      }
      return;
    }

    const vx = event.clientX - rect.left;
    const vy = event.clientY - rect.top;

    // Strip handles take priority — only fires for the editing strip (gated
    // in WASM by the editing flag).
    const handleHit = getCanvas?.()?.hitTestStripEndpoint?.(vx, vy);
    if (handleHit) {
      const parts = handleHit.split(':');
      const fixId = parts[0]!;
      const kind = parts[1]!; // 'vertex' | 'mid'
      const idx = parseInt(parts[2]!, 10);
      const fixture = getFixtures().find(f => String(f.id) === fixId);
      if (fixture && event.button !== 2) {
        if (kind === 'vertex') {
          onStripVertexStart(event, fixture, idx, rect);
          return;
        }
        if (kind === 'mid') {
          onStripMidHandleStart(event, fixture, idx, rect);
          return;
        }
      }
    }

    const rotationHitId = getCanvas?.()?.hitTestRotationZone(vx, vy);
    if (rotationHitId) {
      const fixture = getFixtures().find(f => String(f.id) === rotationHitId);
      if (fixture) { onRotateStart(event, fixture, rect); return; }
    }

    const hitId = getCanvas?.()?.hitTest(vx, vy);
    if (hitId) {
      const fixture = getFixtures().find(f => String(f.id) === hitId);
      if (fixture) { onDragStart(event, fixture, rect); return; }
    }

    const world = toWorld(vx, vy);
    if (!event.shiftKey) {
      selectedIds.value = new Set();
      editingId.value = null;
      editingVertex.value = null;
    }
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
    while (curr) { path.unshift(curr); curr = curr.parent; }

    let targetNode = path[0];
    if (!targetNode) return;

    const selectedIndex = path.findIndex(n => selectedIds.value.has(n.id));
    if (selectedIndex !== -1) {
      if (isDoubleClick && selectedIndex < path.length - 1) {
        targetNode = path[selectedIndex + 1] as SceneNode;
        lastClickId = null;
      } else {
        targetNode = path[selectedIndex] as SceneNode;
      }
    }
    if (!targetNode) return;

    let effectiveSelectedIds: Set<string | number>;
    const wasAlreadySelected = selectedIds.value.has(targetNode.id);
    if (event.shiftKey) {
      const next = new Set(selectedIds.value);
      next.has(targetNode.id) ? next.delete(targetNode.id) : next.add(targetNode.id);
      effectiveSelectedIds = next;
    } else if (!wasAlreadySelected) {
      effectiveSelectedIds = new Set([targetNode.id]);
    } else {
      effectiveSelectedIds = new Set(selectedIds.value);
    }
    selectedIds.value = effectiveSelectedIds;

    // Two-click model for strips: 1st click selects, 2nd click enters edit mode.
    // Any selection change to a different/non-strip fixture exits edit mode.
    if (fixture.stripConfig && wasAlreadySelected && !event.shiftKey) {
      editingId.value = fixture.id;
    } else if (editingId.value !== null && editingId.value !== fixture.id) {
      editingId.value = null;
      editingVertex.value = null;
    }
    // Body-click on the strip (i.e. not a vertex handle hit) clears any
    // previously focused vertex so Delete doesn't accidentally remove one.
    if (editingVertex.value && editingVertex.value.fixtureId !== fixture.id) {
      editingVertex.value = null;
    }

    if (event.button === 2) return;

    const startPositions = new Map<string | number, Point>();
    const startStripPoints = new Map<string | number, StripPoint[]>();
    const w = getWidth();
    const h = getHeight();
    beforeSnapshot = [];
    beforeStripSnapshots = [];
    for (const f of getFixtures()) {
      let isSelected = false;
      let c: SceneNode | null = f as unknown as SceneNode;
      while (c) { if (effectiveSelectedIds.has(c.id)) { isSelected = true; break; } c = c.parent; }
      if (!isSelected) continue;

      if (f.stripConfig) {
        // For strips, points are the source of truth — snapshot them. fixturePosition
        // is derived (centroid), so we don't snapshot it for strips.
        const snap = clonePoints(f.stripConfig.points);
        startStripPoints.set(f.id, snap);
        beforeStripSnapshots.push({ id: f.id, points: snap });
      } else {
        startPositions.set(f.id, { x: f.fixturePosition.x * w, y: f.fixturePosition.y * h });
        beforeSnapshot.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y });
      }
    }
    interaction.value = { type: 'drag', startWorld: world, startPositions, startStripPoints };
  }

  function onRotateStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    if (event.button === 2) return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    let effectiveSelectedIds = new Set(selectedIds.value);
    if (!effectiveSelectedIds.has(fixture.id)) {
      effectiveSelectedIds = new Set([fixture.id]);
      selectedIds.value = effectiveSelectedIds;
    }

    const startAngles = new Map<string | number, number>();
    beforeRotationSnapshot = [];
    let sumX = 0, sumY = 0, count = 0;
    const w = getWidth();
    const h = getHeight();
    for (const f of getFixtures()) {
      if (effectiveSelectedIds.has(f.id)) {
        sumX += f.fixturePosition.x * w;
        sumY += f.fixturePosition.y * h;
        count++;
        startAngles.set(f.id, f.rotation || 0);
        beforeRotationSnapshot.push({ id: f.id, rotation: f.rotation || 0 });
      }
    }
    const centerWorld = { x: count > 0 ? sumX / count : 0, y: count > 0 ? sumY / count : 0 };
    interaction.value = { type: 'rotate', startWorld: world, startAngles, centerWorld };
  }

  /** Begins a vertex drag on a strip's polyline. The vertex follows the cursor freely. */
  function onStripVertexStart(
    event: MouseEvent,
    fixture: Fixture,
    vertexIndex: number,
    rect: DOMRect,
  ) {
    if (event.button === 2 || !fixture.stripConfig) return;
    void rect;
    selectedIds.value = new Set([fixture.id]);
    editingVertex.value = { fixtureId: fixture.id, idx: vertexIndex };

    const snap = clonePoints(fixture.stripConfig.points);
    beforeStripSnapshots = [{ id: fixture.id, points: snap }];

    interaction.value = {
      type: 'strip-vertex',
      fixtureId: fixture.id,
      vertexIndex,
      startPoints: snap,
    };
  }

  /**
   * Mid-segment handle click: inserts a new vertex at the segment midpoint, then
   * immediately starts dragging the new vertex so the user can position it.
   */
  function onStripMidHandleStart(
    event: MouseEvent,
    fixture: Fixture,
    segIndex: number,
    rect: DOMRect,
  ) {
    if (event.button === 2 || !fixture.stripConfig) return;
    void rect;
    const points = fixture.stripConfig.points;
    if (segIndex < 0 || segIndex >= points.length - 1) return;

    selectedIds.value = new Set([fixture.id]);

    // Capture pre-insertion snapshot for undo.
    const beforeSnap = clonePoints(points);
    beforeStripSnapshots = [{ id: fixture.id, points: beforeSnap }];

    // Insert a new vertex at the segment midpoint.
    const p0 = points[segIndex]!;
    const p1 = points[segIndex + 1]!;
    const mid: StripPoint = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    points.splice(segIndex + 1, 0, mid);
    syncStripBounds(fixture);
    // The freshly inserted vertex becomes the focused one — pressing Delete
    // right after inserting therefore removes it again, which matches Figma's
    // behaviour and gives users an obvious "undo via keyboard" path.
    editingVertex.value = { fixtureId: fixture.id, idx: segIndex + 1 };

    interaction.value = {
      type: 'strip-vertex',
      fixtureId: fixture.id,
      vertexIndex: segIndex + 1,
      startPoints: beforeSnap, // before-snapshot includes the pre-insert state
    };
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
      const w = getWidth(); const h = getHeight();
      for (const f of getFixtures()) {
        const start = iv.startPositions.get(f.id);
        if (start) {
          f.fixturePosition.x = toNormalized(snapWorld(start.x + dx), w);
          f.fixturePosition.y = toNormalized(snapWorld(start.y + dy), h);
        }
        const stripStart = iv.startStripPoints.get(f.id);
        if (stripStart && f.stripConfig) {
          // Translate every vertex by the snapped world delta and refresh bounds.
          const sdx = snapWorld(dx);
          const sdy = snapWorld(dy);
          f.stripConfig.points = stripStart.map(p => ({ x: p.x + sdx, y: p.y + sdy }));
          syncStripBounds(f);
        }
      }
    } else if (iv.type === 'rotate') {
      const startAngle = Math.atan2(iv.startWorld.y - iv.centerWorld.y, iv.startWorld.x - iv.centerWorld.x);
      const currAngle  = Math.atan2(world.y - iv.centerWorld.y, world.x - iv.centerWorld.x);
      const deltaDeg = (currAngle - startAngle) * (180 / Math.PI);
      for (const f of getFixtures()) {
        const startR = iv.startAngles.get(f.id);
        if (startR !== undefined) {
          let r = startR + deltaDeg;
          if (event.shiftKey) r = Math.round(r / 15) * 15;
          r = ((r % 360) + 360) % 360;
          f.rotation = r;
        }
      }
    } else if (iv.type === 'strip-vertex') {
      const f = getFixtures().find(fx => fx.id === iv.fixtureId);
      if (!f || !f.stripConfig) return;
      const p = f.stripConfig.points[iv.vertexIndex];
      if (!p) return;
      p.x = event.shiftKey ? snapWorld(world.x) : world.x;
      p.y = event.shiftKey ? snapWorld(world.y) : world.y;
      // No length enforcement — the renderer trims/extends the curve to the
      // strip's target length, walking from the star (vertex 0) anchor.
      syncStripBounds(f);
    }
  }

  function onMouseUp() {
    const iv = interaction.value;

    if (iv.type === 'marquee') {
      const minX = Math.min(iv.start.x, iv.end.x), maxX = Math.max(iv.start.x, iv.end.x);
      const minY = Math.min(iv.start.y, iv.end.y), maxY = Math.max(iv.start.y, iv.end.y);
      const hit = new Set<string | number>();
      const w = getWidth(); const h = getHeight();
      for (const f of getFixtures()) {
        const wx = f.fixturePosition.x * w, wy = f.fixturePosition.y * h;
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
          const path: SceneNode[] = [];
          let curr: SceneNode | null = f as unknown as SceneNode;
          while (curr) { path.unshift(curr); curr = curr.parent; }
          if (path[0]) hit.add(path[0].id);
        }
      }
      selectedIds.value = hit;
    } else if (iv.type === 'drag') {
      // Non-strip moves → MoveFixtureCommand.
      if (beforeSnapshot.length > 0 && onDragComplete) {
        const afterSnapshot = beforeSnapshot.map(snap => {
          const f = getFixtures().find(f => f.id === snap.id);
          return { id: snap.id, x: f ? f.fixturePosition.x : snap.x, y: f ? f.fixturePosition.y : snap.y };
        });
        const didMove = beforeSnapshot.some((b, i) => { const a = afterSnapshot[i]; return a && (b.x !== a.x || b.y !== a.y); });
        if (didMove) onDragComplete(beforeSnapshot, afterSnapshot);
      }
      // Strip reshapes → one ReshapeStripCommand per strip.
      if (beforeStripSnapshots.length > 0 && onReshapeStrip) {
        for (const before of beforeStripSnapshots) {
          const f = getFixtures().find(fx => fx.id === before.id);
          if (!f || !f.stripConfig) continue;
          const after: StripPointsSnapshot = { id: before.id, points: clonePoints(f.stripConfig.points) };
          const changed = before.points.length !== after.points.length
            || before.points.some((p, i) => p.x !== after.points[i]!.x || p.y !== after.points[i]!.y);
          if (changed) onReshapeStrip(before, after);
        }
      }
      beforeSnapshot = [];
      beforeStripSnapshots = [];
    } else if (iv.type === 'rotate' && beforeRotationSnapshot.length > 0 && onRotateComplete) {
      const afterSnapshot = beforeRotationSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return { id: snap.id, rotation: f ? (f.rotation || 0) : snap.rotation };
      });
      const didRotate = beforeRotationSnapshot.some((b, i) => afterSnapshot[i] && b.rotation !== afterSnapshot[i]!.rotation);
      if (didRotate) onRotateComplete(beforeRotationSnapshot, afterSnapshot);
      beforeRotationSnapshot = [];
    } else if (iv.type === 'strip-vertex') {
      if (beforeStripSnapshots.length > 0 && onReshapeStrip) {
        const before = beforeStripSnapshots[0]!;
        const f = getFixtures().find(fx => fx.id === before.id);
        if (f && f.stripConfig) {
          const after: StripPointsSnapshot = { id: before.id, points: clonePoints(f.stripConfig.points) };
          const changed = before.points.length !== after.points.length
            || before.points.some((p, i) => !after.points[i] || p.x !== after.points[i]!.x || p.y !== after.points[i]!.y);
          if (changed) onReshapeStrip(before, after);
        }
      }
      beforeStripSnapshots = [];
    }

    interaction.value = { type: 'idle' };
  }

  /**
   * Right-click a vertex to delete it (only when the strip has > 2 vertices).
   * Returns true if a vertex was deleted, so the caller can suppress the
   * subsequent context menu / selection update.
   */
  function tryDeleteVertexAt(vx: number, vy: number): boolean {
    const handleHit = getCanvas?.()?.hitTestStripEndpoint?.(vx, vy);
    if (!handleHit) return false;
    const parts = handleHit.split(':');
    if (parts[1] !== 'vertex') return false;
    const fixId = parts[0]!;
    const idx = parseInt(parts[2]!, 10);
    const fixture = getFixtures().find(f => String(f.id) === fixId);
    if (!fixture || !fixture.stripConfig) return false;
    if (fixture.stripConfig.points.length <= 2) return false;

    const before: StripPointsSnapshot = { id: fixture.id, points: clonePoints(fixture.stripConfig.points) };
    fixture.stripConfig.points.splice(idx, 1);
    syncStripBounds(fixture);
    const after: StripPointsSnapshot = { id: fixture.id, points: clonePoints(fixture.stripConfig.points) };
    onReshapeStrip?.(before, after);
    return true;
  }

  /**
   * Removes the currently focused vertex (set when the user last clicked a
   * vertex handle). Returns true if a vertex was actually removed. Guards
   * against deleting the anchor (vertex 0) and against collapsing a strip
   * below 2 vertices.
   */
  function deleteEditingVertex(): boolean {
    const ev = editingVertex.value;
    if (!ev) return false;
    const fixture = getFixtures().find(f => f.id === ev.fixtureId);
    if (!fixture || !fixture.stripConfig) return false;
    if (fixture.stripConfig.points.length <= 2) return false;
    // Don't delete the anchor — it defines the strip's start.
    if (ev.idx === 0) return false;
    const idx = Math.min(ev.idx, fixture.stripConfig.points.length - 1);

    const before: StripPointsSnapshot = { id: fixture.id, points: clonePoints(fixture.stripConfig.points) };
    fixture.stripConfig.points.splice(idx, 1);
    syncStripBounds(fixture);
    const after: StripPointsSnapshot = { id: fixture.id, points: clonePoints(fixture.stripConfig.points) };
    onReshapeStrip?.(before, after);
    // After deletion, focus shifts to the vertex that took the deleted one's
    // place (or the new last vertex if we deleted the tail).
    const newIdx = Math.min(idx, fixture.stripConfig.points.length - 1);
    editingVertex.value = { fixtureId: fixture.id, idx: newIdx };
    return true;
  }

  return {
    selectedIds,
    editingId,
    editingVertex,
    interaction,
    onViewportMouseDown,
    onDragStart,
    onRotateStart,
    onMouseMove,
    onMouseUp,
    tryDeleteVertexAt,
    deleteEditingVertex,
  };
}
