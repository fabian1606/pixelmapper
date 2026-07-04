import { ref } from 'vue';
import type { Fixture, StripPoint } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import type { SceneNode } from '~/utils/engine/core/group';
import type { FixtureRotationSnapshot } from '../commands/rotate-fixture-command';
import type { StripPointsSnapshot } from '../commands/reshape-strip-command';
import { syncStripBounds, enforceStripLength } from '~/utils/engine/neopixel-strip-factory';
import { resolveSnapSpacing, type ZoomTier } from '~/utils/engine/snap-policy';
import {
  NEAR_ZOOM_SCALE_THRESHOLD,
  FAR_ZOOM_SCALE_THRESHOLD,
  COARSE_SNAP_METERS,
  WORLD_WIDTH,
  STAGE_SIZE_METERS,
} from '~/utils/engine/constants';
import { useEngineStore } from '~/stores/engine-store';
import {
  isAdditiveModifier,
  buildAncestorPath,
  resolveClickSelection,
  createDoubleClickTracker,
  distanceToSegment,
  LINE_SELECT_PICKUP_PX,
  CLICK_MOVE_THRESHOLD_PX,
} from '~/utils/engine/selection-logic';

export type Interaction =
  | { type: 'idle' }
  | { type: 'marquee'; start: Point; end: Point }
  /** Shift-drag: draws a virtual line; fixtures the line passes near get selected. */
  | { type: 'line'; start: Point; end: Point }
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
/** 0.5m coarse snap, converted to world-pixels (world px per meter = WORLD_WIDTH / STAGE_SIZE_METERS). */
const COARSE_SPACING_WORLD_PX = COARSE_SNAP_METERS * (WORLD_WIDTH / STAGE_SIZE_METERS);

function zoomTierForScale(scale: number): ZoomTier {
  if (scale >= NEAR_ZOOM_SCALE_THRESHOLD) return 'near';
  if (scale <= FAR_ZOOM_SCALE_THRESHOLD) return 'far';
  return 'mid';
}

function snapWorld(px: number, spacing: number): number {
  return Math.round(px / spacing) * spacing;
}

function toNormalized(px: number, max: number): number {
  return px / max;
}

function clonePoints(pts: StripPoint[]): StripPoint[] {
  return pts.map(p => ({ x: p.x, y: p.y }));
}

/** Ctrl/Cmd trigger additive/toggle multi-select; Shift is reserved for the line-select tool. */
function isAdditiveClick(event: MouseEvent): boolean {
  return isAdditiveModifier(event);
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
  getScale?: () => number,
) {
  const engineStore = useEngineStore();
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

  const doubleClickTracker = createDoubleClickTracker();
  /**
   * Anchor fixture for Shift range-select — the last fixture clicked without
   * Shift. A Shift-click extends the selection from here to the clicked fixture
   * over the flat fixture order, exactly like a list. Set in `onDragStart`.
   */
  let rangeAnchorId: string | number | null = null;
  /** Fixture under the cursor when a Shift gesture began (range-select target if it's a click, not a drag). */
  let shiftDownFixtureId: string | number | null = null;
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

    // Shift → range/line select. Takes priority over fixture/handle hit-tests so
    // a shift gesture never grabs or drags a fixture. On mouse-up we decide:
    //   • barely moved → list-style range select (anchor → clicked fixture)
    //   • dragged      → line-select (fixtures the drawn line crosses)
    // The fixture under the cursor at press time is the range target.
    if (event.shiftKey) {
      const world = toWorld(vx, vy);
      const hitId = getCanvas?.()?.hitTest(vx, vy);
      shiftDownFixtureId = hitId ? (getFixtures().find(f => String(f.id) === hitId)?.id ?? null) : null;
      interaction.value = { type: 'line', start: { ...world }, end: { ...world } };
      return;
    }

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
    if (!isAdditiveClick(event)) {
      selectedIds.value = new Set();
      editingId.value = null;
      editingVertex.value = null;
    }
    interaction.value = { type: 'marquee', start: { ...world }, end: { ...world } };
  }

  function onDragStart(event: MouseEvent, fixture: Fixture, rect: DOMRect) {
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);

    // Remember this fixture as the anchor for the next Shift range-select.
    rangeAnchorId = fixture.id;

    const isDoubleClick = doubleClickTracker.check(fixture.id, performance.now());
    const path = buildAncestorPath(fixture as unknown as SceneNode);
    const additive = isAdditiveClick(event);
    const { nextSelected, wasAlreadySelected, drilled } =
      resolveClickSelection(path, selectedIds.value, isDoubleClick, additive);
    if (drilled) doubleClickTracker.reset();

    const effectiveSelectedIds = nextSelected;
    selectedIds.value = effectiveSelectedIds;

    // Two-click model for strips: 1st click selects, 2nd click enters edit mode.
    // ONLY for bezier strips — line/circle have no edit mode (LED-dot hit-tests
    // handle direct endpoint/center grabs, see hit_test_strip_endpoint).
    if (
      fixture.stripConfig &&
      fixture.stripConfig.shapeType === 'bezier' &&
      wasAlreadySelected &&
      !additive
    ) {
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
    } else if (iv.type === 'line') {
      interaction.value = { ...iv, end: world };
    } else if (iv.type === 'drag') {
      const dx = world.x - iv.startWorld.x;
      const dy = world.y - iv.startWorld.y;
      const w = getWidth(); const h = getHeight();
      const tier = zoomTierForScale(getScale?.() ?? 1);
      const spacing = resolveSnapSpacing(tier, event.shiftKey, DOT_SPACING, COARSE_SPACING_WORLD_PX);
      // Snap the drag delta itself (once), not each fixture's absolute end
      // position — otherwise every fixture in a multi-selection/group would
      // round to the grid independently and the group's relative layout
      // would fall apart. Snapping the shared delta keeps the whole
      // selection moving together, snapped as one.
      const snappedDx = spacing !== null ? snapWorld(dx, spacing) : dx;
      const snappedDy = spacing !== null ? snapWorld(dy, spacing) : dy;
      for (const f of getFixtures()) {
        const start = iv.startPositions.get(f.id);
        if (start) {
          f.fixturePosition.x = toNormalized(start.x + snappedDx, w);
          f.fixturePosition.y = toNormalized(start.y + snappedDy, h);
        }
        const stripStart = iv.startStripPoints.get(f.id);
        if (stripStart && f.stripConfig) {
          f.stripConfig.points = stripStart.map(p => ({ x: p.x + snappedDx, y: p.y + snappedDy }));
          syncStripBounds(f);
        }
      }
      // Fixture position fields are plain (non-reactive), mutated directly above
      // for drag performance — bump layoutRevision so the position panel (and
      // any other layoutRevision-gated UI) stays live during the drag, exactly
      // like the 3D gizmo's handleDragMove does via the same call.
      engineStore.triggerCanvasSync();
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
      engineStore.triggerCanvasSync();
    } else if (iv.type === 'strip-vertex') {
      const f = getFixtures().find(fx => fx.id === iv.fixtureId);
      if (!f || !f.stripConfig) return;
      const p = f.stripConfig.points[iv.vertexIndex];
      if (!p) return;
      p.x = event.shiftKey ? snapWorld(world.x, DOT_SPACING) : world.x;
      p.y = event.shiftKey ? snapWorld(world.y, DOT_SPACING) : world.y;
      // For bezier, the renderer trims/extends the curve to target length;
      // no in-place enforcement needed (matches existing behavior). For line,
      // the user drags one endpoint and we snap the OTHER endpoint along the
      // current direction so the visible length stays exactly target_length.
      if (f.stripConfig.shapeType === 'line') {
        enforceStripLength(f, iv.vertexIndex);
      } else {
        syncStripBounds(f);
      }
      engineStore.triggerCanvasSync();
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
          const path = buildAncestorPath(f as unknown as SceneNode);
          hit.add(path[0]!.id);
        }
      }
      selectedIds.value = hit;
    } else if (iv.type === 'line') {
      // Two shapes of the same "select fixtures along a segment" gesture:
      //   • Shift-CLICK on a fixture → ray from the currently-selected anchor
      //     fixture to the clicked fixture (endpoints are the two fixtures).
      //   • Shift-DRAG → the freely drawn line (endpoints are the cursor path).
      // Both then select every fixture whose center lies within the pickup
      // radius of that segment — individual fixtures, groups ignored.
      const scale = getScale?.() ?? 1;
      const w = getWidth(); const h = getHeight();
      const movedScreen = Math.hypot(iv.end.x - iv.start.x, iv.end.y - iv.start.y) * scale;
      const isClick = movedScreen <= CLICK_MOVE_THRESHOLD_PX && shiftDownFixtureId !== null;

      let ax = iv.start.x, ay = iv.start.y, bx = iv.end.x, by = iv.end.y;
      let anchorless = false;
      if (isClick) {
        const fixtures = getFixtures();
        let anchor = rangeAnchorId;
        if (anchor === null || !fixtures.some(f => f.id === anchor)) {
          anchor = fixtures.find(f => selectedIds.value.has(f.id))?.id ?? null;
        }
        const anchorFix = anchor !== null ? fixtures.find(f => f.id === anchor) : undefined;
        const targetFix = fixtures.find(f => f.id === shiftDownFixtureId);
        if (anchorFix && targetFix && anchorFix.id !== targetFix.id) {
          ax = anchorFix.fixturePosition.x * w; ay = anchorFix.fixturePosition.y * h;
          bx = targetFix.fixturePosition.x * w; by = targetFix.fixturePosition.y * h;
        } else {
          anchorless = true; // nothing to draw a ray from → just select the clicked fixture
        }
      }

      if (anchorless) {
        selectedIds.value = new Set([shiftDownFixtureId!]);
      } else {
        const threshold = LINE_SELECT_PICKUP_PX / (scale || 1);
        const hit = new Set<string | number>();
        for (const f of getFixtures()) {
          const fx = f.fixturePosition.x * w, fy = f.fixturePosition.y * h;
          if (distanceToSegment(fx, fy, ax, ay, bx, by) <= threshold) hit.add(f.id);
        }
        selectedIds.value = hit;
      }
      shiftDownFixtureId = null;
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
