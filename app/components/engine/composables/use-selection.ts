import { ref } from 'vue';
import type { Json } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Point } from './use-camera';
import type { FixturePositionSnapshot } from '../commands/move-fixture-command';
import type { SceneNode } from '~/utils/engine/core/group';
import type { FixtureRotationSnapshot } from '../commands/rotate-fixture-command';
import { cloneJson, getKind, kindContext, rebuildKindFixture, worldToKind } from '~/utils/kinds/kind-host';
import { hasEditHandles } from '~/utils/kinds/kind-canvas';
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
import {
  resolveAlignmentContext,
  buildAlignmentSession,
  queryAlignment,
  bboxCenter,
  ALIGN_TOLERANCE_PX,
  type AlignmentSession,
  type AlignmentResult,
} from '~/utils/engine/alignment-guides';

export type Interaction =
  | { type: 'idle' }
  | { type: 'marquee'; start: Point; end: Point }
  /** Shift-drag: draws a virtual line; fixtures the line passes near get selected. */
  | { type: 'line'; start: Point; end: Point }
  | {
      type: 'drag';
      startWorld: Point;
      /** Pre-drag fixturePosition in world-pixels of every selected fixture. */
      startPositions: Map<string | number, Point>;
    }
  | { type: 'rotate'; startWorld: Point; startAngles: Map<string | number, number>; centerWorld: Point }
  | {
      /** Drag a fixture-kind handle; the kind's `onHandleMove` maps it to a config. */
      type: 'kind-handle';
      fixtureId: string | number;
      handleId: string;
      /** Config at drag start (onHandleMove is always applied to it). JSON; typed `unknown` to keep ref unwrapping shallow. */
      startConfig: unknown;
    };

export interface CanvasHitTester {
  hitTest: (x: number, y: number) => string | undefined;
  hitTestRotationZone: (x: number, y: number) => string | undefined;
  /** Active fixture-kind handle under the point (anchors when selected, all in edit mode). */
  hitTestHandle?: (x: number, y: number) => { fixtureId: string; handleId: string } | undefined;
}

/** A focused kind handle (highlight ring, Delete target). */
export interface FocusedHandle {
  fixtureId: string | number;
  handleId: string;
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
  /** Commits a kind config change (one undo step). */
  onKindConfigChange?: (fixture: Fixture, before: Json, after: Json, description: string) => void,
  getScale?: () => number,
  getSceneNodes?: () => SceneNode[],
  getViewportSize?: () => { width: number; height: number },
) {
  const engineStore = useEngineStore();
  const selectedIds = externalSelectedIds ?? ref<Set<string | number>>(new Set());
  const interaction = ref<Interaction>({ type: 'idle' });
  /**
   * Id of the kind fixture currently in edit mode — at most one at a time.
   * Entered by clicking an already-selected kind fixture that has non-anchor
   * handles; cleared when the selection moves elsewhere. Non-anchor handles
   * are only drawn and hit-tested for this fixture.
   */
  const editingId = ref<string | number | null>(null);
  /**
   * The focused handle — set when the user grabs a handle, consumed by
   * `deleteFocusedHandle()` (Delete / Backspace). Cleared when the user
   * clicks elsewhere.
   */
  const focusedHandle = ref<FocusedHandle | null>(null);

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
  /** Figma-style alignment guides: per-axis sorted candidate centers, built once per drag. */
  let alignSession: AlignmentSession | null = null;
  /** Live guide/spacing data for the SVG overlay — null except while a drag has active matches. */
  const alignmentGuides = ref<AlignmentResult | null>(null);

  /**
   * Builds the alignment session for a starting drag: freezes the set of
   * fixtures visible in the viewport, resolves the Figma context rules, and
   * sorts the candidate centers per axis. All in world-pixels.
   */
  function beginAlignmentSession(
    effectiveSelectedIds: Set<string | number>,
    startPositions: Map<string | number, Point>,
  ): void {
    alignSession = null;
    const sceneNodes = getSceneNodes?.();
    const viewport = getViewportSize?.();
    if (!sceneNodes || !viewport) return;
    const w = getWidth(); const h = getHeight();

    const topLeft = toWorld(0, 0);
    const bottomRight = toWorld(viewport.width, viewport.height);
    const visible = new Set<string | number>();
    for (const f of getFixtures()) {
      const wx = f.fixturePosition.x * w, wy = f.fixturePosition.y * h;
      if (wx >= topLeft.x && wx <= bottomRight.x && wy >= topLeft.y && wy <= bottomRight.y) visible.add(f.id);
    }

    const candidates = resolveAlignmentContext(sceneNodes, effectiveSelectedIds, visible)
      .map(c => {
        const points = c.fixtures.map(f => [f.fixturePosition.x * w, f.fixturePosition.y * h]);
        return { id: c.id, center: bboxCenter(points), points };
      });
    if (candidates.length === 0) return;

    // Selection center = bbox center over every moving fixture center.
    const points: number[][] = [];
    for (const p of startPositions.values()) points.push([p.x, p.y]);
    if (points.length === 0) return;

    alignSession = buildAlignmentSession(candidates, bboxCenter(points), points);
  }

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

    // Kind handles take priority (gated in WASM: anchors when selected,
    // everything in edit mode).
    const handleHit = getCanvas?.()?.hitTestHandle?.(vx, vy);
    if (handleHit && event.button !== 2) {
      const fixture = getFixtures().find(f => String(f.id) === handleHit.fixtureId);
      if (fixture) {
        onKindHandleStart(fixture, handleHit.handleId);
        return;
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
      focusedHandle.value = null;
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

    // Two-click model for kind fixtures: 1st click selects, 2nd click enters
    // edit mode — only when the kind has non-anchor handles.
    if (hasEditHandles(fixture) && wasAlreadySelected && !additive) {
      editingId.value = fixture.id;
    } else if (editingId.value !== null && editingId.value !== fixture.id) {
      editingId.value = null;
    }
    // A body click (not a handle) clears the focused handle so Delete
    // doesn't remove one by accident.
    focusedHandle.value = null;

    if (event.button === 2) return;

    // Every fixture moves by its origin (kind geometry is origin-relative).
    const startPositions = new Map<string | number, Point>();
    const w = getWidth();
    const h = getHeight();
    beforeSnapshot = [];
    for (const f of getFixtures()) {
      let isSelected = false;
      let c: SceneNode | null = f as unknown as SceneNode;
      while (c) { if (effectiveSelectedIds.has(c.id)) { isSelected = true; break; } c = c.parent; }
      if (!isSelected) continue;
      startPositions.set(f.id, { x: f.fixturePosition.x * w, y: f.fixturePosition.y * h });
      beforeSnapshot.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y });
    }
    beginAlignmentSession(effectiveSelectedIds, startPositions);
    interaction.value = { type: 'drag', startWorld: world, startPositions };
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

  /** Begins dragging a kind handle; the fixture becomes the sole selection. */
  function onKindHandleStart(fixture: Fixture, handleId: string) {
    if (!fixture.kind) return;
    selectedIds.value = new Set([fixture.id]);
    focusedHandle.value = { fixtureId: fixture.id, handleId };
    interaction.value = { type: 'kind-handle', fixtureId: fixture.id, handleId, startConfig: cloneJson(fixture.kind.config) };
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
      // Per axis, alignment guides win over the grid: queryAlignment snaps
      // matched axes to candidate centers / equal spacings and grid-snaps
      // the rest (gridSpacing param).
      let snappedDx: number, snappedDy: number;
      if (alignSession) {
        const tolerance = ALIGN_TOLERANCE_PX / (getScale?.() ?? 1);
        const res = queryAlignment(alignSession, [dx, dy], [tolerance, tolerance], [spacing, spacing]);
        snappedDx = res.snappedDelta[0]!;
        snappedDy = res.snappedDelta[1]!;
        alignmentGuides.value = res.guides.length > 0 || res.spacing.length > 0 ? res : null;
      } else {
        snappedDx = spacing !== null ? snapWorld(dx, spacing) : dx;
        snappedDy = spacing !== null ? snapWorld(dy, spacing) : dy;
      }
      for (const f of getFixtures()) {
        const start = iv.startPositions.get(f.id);
        if (start) {
          f.fixturePosition.x = toNormalized(start.x + snappedDx, w);
          f.fixturePosition.y = toNormalized(start.y + snappedDy, h);
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
    } else if (iv.type === 'kind-handle') {
      const f = getFixtures().find(fx => fx.id === iv.fixtureId);
      const kind = f?.kind ? getKind(f.kind.id) : undefined;
      if (!f?.kind || !kind?.def.onHandleMove) return;
      const pos = event.shiftKey ? { x: snapWorld(world.x, DOT_SPACING), y: snapWorld(world.y, DOT_SPACING) } : world;
      try {
        // Pure: always from the drag-start config.
        f.kind.config = kind.def.onHandleMove(cloneJson(iv.startConfig) as Json, iv.handleId, worldToKind(f, pos), kindContext(f.id));
        rebuildKindFixture(f);
      }
      catch (err) {
        console.error(`[kinds] ${f.kind.id} onHandleMove failed:`, err);
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
      // Moves → MoveFixtureCommand.
      if (beforeSnapshot.length > 0 && onDragComplete) {
        const afterSnapshot = beforeSnapshot.map(snap => {
          const f = getFixtures().find(f => f.id === snap.id);
          return { id: snap.id, x: f ? f.fixturePosition.x : snap.x, y: f ? f.fixturePosition.y : snap.y };
        });
        const didMove = beforeSnapshot.some((b, i) => { const a = afterSnapshot[i]; return a && (b.x !== a.x || b.y !== a.y); });
        if (didMove) onDragComplete(beforeSnapshot, afterSnapshot);
      }
      beforeSnapshot = [];
    } else if (iv.type === 'rotate' && beforeRotationSnapshot.length > 0 && onRotateComplete) {
      const afterSnapshot = beforeRotationSnapshot.map(snap => {
        const f = getFixtures().find(f => f.id === snap.id);
        return { id: snap.id, rotation: f ? (f.rotation || 0) : snap.rotation };
      });
      const didRotate = beforeRotationSnapshot.some((b, i) => afterSnapshot[i] && b.rotation !== afterSnapshot[i]!.rotation);
      if (didRotate) onRotateComplete(beforeRotationSnapshot, afterSnapshot);
      beforeRotationSnapshot = [];
    } else if (iv.type === 'kind-handle') {
      const f = getFixtures().find(fx => fx.id === iv.fixtureId);
      if (f?.kind && JSON.stringify(f.kind.config) !== JSON.stringify(iv.startConfig)) {
        onKindConfigChange?.(f, iv.startConfig as Json, cloneJson(f.kind.config) as Json, `Edit ${f.name}`);
      }
    }

    interaction.value = { type: 'idle' };
    alignSession = null;
    alignmentGuides.value = null;
  }

  /** Applies the kind's `onHandleDelete`; returns true when the config changed. */
  function deleteHandle(fixture: Fixture, handleId: string): boolean {
    const kind = fixture.kind ? getKind(fixture.kind.id) : undefined;
    if (!fixture.kind || !kind?.def.onHandleDelete) return false;
    const before = cloneJson(fixture.kind.config) as Json;
    let after: Json;
    try {
      after = kind.def.onHandleDelete(cloneJson(before), handleId, kindContext(fixture.id));
    }
    catch (err) {
      console.error(`[kinds] ${fixture.kind.id} onHandleDelete failed:`, err);
      return false;
    }
    if (JSON.stringify(after) === JSON.stringify(before)) return false;
    fixture.kind.config = after;
    rebuildKindFixture(fixture);
    onKindConfigChange?.(fixture, before, cloneJson(after), `Edit ${fixture.name}`);
    return true;
  }

  /**
   * Right-click on a handle deletes it when the kind allows it. Returns true
   * if something was deleted, so the caller can suppress the context menu.
   */
  function tryDeleteHandleAt(vx: number, vy: number): boolean {
    const hit = getCanvas?.()?.hitTestHandle?.(vx, vy);
    if (!hit) return false;
    const fixture = getFixtures().find(f => String(f.id) === hit.fixtureId);
    return fixture ? deleteHandle(fixture, hit.handleId) : false;
  }

  /** Deletes the focused handle (Delete / Backspace). */
  function deleteFocusedHandle(): boolean {
    const fh = focusedHandle.value;
    if (!fh) return false;
    const fixture = getFixtures().find(f => f.id === fh.fixtureId);
    if (!fixture || !deleteHandle(fixture, fh.handleId)) return false;
    focusedHandle.value = null;
    return true;
  }

  return {
    selectedIds,
    editingId,
    focusedHandle,
    interaction,
    alignmentGuides,
    onViewportMouseDown,
    onDragStart,
    onRotateStart,
    onMouseMove,
    onMouseUp,
    tryDeleteHandleAt,
    deleteFocusedHandle,
  };
}
