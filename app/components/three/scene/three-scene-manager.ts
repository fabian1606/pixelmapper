import {
  Color,
  Euler,
  Group,
  MathUtils,
  NoToneMapping,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Fixture } from '~/utils/engine/core/fixture';
import { buildSceneModel, type BodyModel } from './fixture-adapter';
import { AlignmentGuides3D, type AlignmentGuideData } from './alignment-guides-3d';
import { PixelCloud } from './pixel-instances';
import { BeamCones } from './beam-cones';
import { FixtureBodies } from './fixture-bodies';
import { BodyPolylines } from './body-polylines';
import { BodyShapes } from './body-shapes';
import { SvgPlanes } from './svg-planes';
import { buildStage, type Stage } from './stage';
import {
  FLOOR_MARGIN_METERS,
  FLOOR_MIN_SIZE_METERS,
  NEAR_ZOOM_DISTANCE_METERS,
  FAR_ZOOM_DISTANCE_METERS,
  COARSE_SNAP_METERS,
} from '~/utils/engine/constants';
import { resolveSnapSpacing, type ZoomTier } from '~/utils/engine/snap-policy';
import { distanceToSegment, LINE_SELECT_PICKUP_PX, CLICK_MOVE_THRESHOLD_PX } from '~/utils/engine/selection-logic';
import { normalizeWheelDelta } from '~/utils/engine/wheel';

export type GizmoMode = 'translate' | 'rotate';

export interface SelectionModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface TransformDelta {
  /** Translation delta in world meters. */
  position: Vector3;
  /** Rotation delta in degrees, mapped to fixture fields (rotation/tiltX/rollZ). */
  rotationDeg: number;
  tiltXDeg: number;
  rollZDeg: number;
}

export interface SceneManagerCallbacks {
  /** Non-reactive accessor for the current mixed DMX output buffer. */
  getDmx: () => Uint8Array;
  /** Non-reactive accessor for elapsed engine time in ms — drives strobe animation. */
  getElapsed?: () => number;
  /** Non-reactive accessor for the (raw, un-proxied) fixture list. */
  getFixtures: () => Fixture[];
  /** Click selection. id === null → clicked empty space. Raw modifiers so the caller applies the shared additive rule itself. */
  onSelect: (id: string | number | null, mods: SelectionModifiers) => void;
  /** Shift-CLICK on a fixture (no drag) → list-style range select. id === null → clicked empty space. */
  onShiftClick?: (id: string | number | null, mods: SelectionModifiers) => void;
  /** Live update while a Shift-drag line-select is in progress, in canvas CSS-pixels. Null when the gesture ends. */
  onLineDrag?: (line: { x1: number; y1: number; x2: number; y2: number } | null) => void;
  /** Committed result of a Shift-drag line-select. */
  onLineSelect?: (ids: Set<string | number>, mods: SelectionModifiers) => void;
  /** Live update while a Ctrl/Cmd-drag box-select is in progress, in canvas CSS-pixels. Null when the gesture ends. */
  onBoxDrag?: (box: { x1: number; y1: number; x2: number; y2: number } | null) => void;
  /** Committed result of a Ctrl/Cmd-drag box-select. */
  onBoxSelect?: (ids: Set<string | number>, mods: SelectionModifiers) => void;
  onDragStart: () => void;
  /**
   * Fired continuously during a gizmo drag with the total delta since drag
   * start. A translate handler may return the delta it actually applied
   * ([x, y, z] world meters, e.g. after alignment/grid snapping) — the pivot
   * is then written back to that position so the gizmo visibly sticks to the
   * snap instead of following the raw pointer.
   */
  onDragMove: (mode: GizmoMode, delta: TransformDelta) => number[] | void;
  onDragEnd: (mode: GizmoMode) => void;
}

const RAD2DEG = 180 / Math.PI;

/** Shift-to-snap increments — mirrors the 2D canvas's shift-hold rotate snap (15°). */
const TRANSLATE_SNAP_METERS = 0.1;
const ROTATE_SNAP_DEG = 15;

/**
 * Plain-TS orchestrator for the 3D viewport. Owns renderer/scene/camera and
 * all render objects; deliberately holds no Vue reactivity — the hosting
 * component passes plain accessors and watches store signals to drive
 * rebuild()/setSelection().
 */
export class ThreeSceneManager {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private pivot = new Group();

  private pixels = new PixelCloud();
  private beams: BeamCones;
  private bodies: FixtureBodies;
  private polylines: BodyPolylines;
  private shapes: BodyShapes;
  private svgPlanes: SvgPlanes;
  private stage: Stage;
  private alignGuides: AlignmentGuides3D;

  private raycaster = new Raycaster();
  private pointerNdc = new Vector2();
  private rafId: number | null = null;
  private running = false;

  private shiftHeld = false;

  private selectedIds = new Set<string | number>();
  private dragging = false;
  private dragStartPos = new Vector3();
  private dragStartEuler = new Euler(0, 0, 0, 'YXZ');
  private downX = 0;
  private downY = 0;
  private downOnGizmo = false;

  /** Shift-drag line-select — mirrors the 2D canvas's 'line' interaction. Coordinates are canvas-relative CSS pixels. */
  private lineDragging = false;
  private lineStart = { x: 0, y: 0 };
  private lineEnd = { x: 0, y: 0 };

  /** Ctrl/Cmd-drag box-select. Coordinates are canvas-relative CSS pixels. */
  private boxDragging = false;
  private boxStart = { x: 0, y: 0 };
  private boxEnd = { x: 0, y: 0 };

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, private callbacks: SceneManagerCallbacks) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;

    this.scene.background = new Color(0x000004);
    this.stage = buildStage(this.scene);

    this.camera = new PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(10, 8, 10);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 0, 0);
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 45;
    // A genuine two-finger touch (tablet) drag should pan, not the default
    // DOLLY_PAN which also zooms on the slightest change in finger spacing.
    this.orbit.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.PAN };
    // Wheel is handled entirely by onWheel below, mirroring the 2D canvas's
    // convention (use-camera.ts onWheel): a trackpad's two-finger swipe fires
    // as wheel events (not touch events), so OrbitControls' default
    // wheel-always-zooms binding can't tell that gesture apart from a pinch.
    this.orbit.enableZoom = false;
    this.orbit.addEventListener('change', () => this.applySnapPolicy());

    this.beams = new BeamCones(this.scene);
    this.bodies = new FixtureBodies(this.scene);
    this.polylines = new BodyPolylines(this.scene);
    this.shapes = new BodyShapes(this.scene);
    this.svgPlanes = new SvgPlanes(this.scene);
    this.alignGuides = new AlignmentGuides3D(this.scene);
    this.scene.add(this.pixels.points);
    this.scene.add(this.pivot);
    this.pivot.rotation.order = 'YXZ';

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.size = 0.67;
    this.gizmo.setMode('translate');
    this.gizmo.attach(this.pivot);
    this.gizmo.enabled = false;
    this.gizmo.getHelper().visible = false;
    this.scene.add(this.gizmo.getHelper());

    this.gizmo.addEventListener('dragging-changed', (e: { value?: unknown }) => {
      const active = Boolean(e.value);
      this.orbit.enabled = !active;
      if (active) {
        this.dragging = true;
        this.dragStartPos.copy(this.pivot.position);
        this.dragStartEuler.copy(this.pivot.rotation);
        this.callbacks.onDragStart();
      } else if (this.dragging) {
        this.dragging = false;
        this.alignGuides.clear();
        this.callbacks.onDragEnd(this.gizmo.mode as GizmoMode);
        // Snap pivot back onto the (possibly clamped) committed selection.
        this.refreshPivot();
      }
    });

    this.gizmo.addEventListener('objectChange', () => {
      if (!this.dragging) return;
      const delta: TransformDelta = {
        position: this.pivot.position.clone().sub(this.dragStartPos),
        // fixture.rotation maps to eulerY = -rotation (2D screen-space spin).
        rotationDeg: -(this.pivot.rotation.y - this.dragStartEuler.y) * RAD2DEG,
        tiltXDeg: (this.pivot.rotation.x - this.dragStartEuler.x) * RAD2DEG,
        rollZDeg: (this.pivot.rotation.z - this.dragStartEuler.z) * RAD2DEG,
      };
      const applied = this.callbacks.onDragMove(this.gizmo.mode as GizmoMode, delta);
      // Sticky snapping: park the gizmo on the delta the handler actually
      // applied (alignment/grid snapped), not the raw pointer position.
      if (applied && this.gizmo.mode === 'translate') {
        this.pivot.position.set(
          this.dragStartPos.x + applied[0]!,
          this.dragStartPos.y + applied[1]!,
          this.dragStartPos.z + applied[2]!,
        );
      }
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.applySnapPolicy();
  }

  // ── Zoom-tiered snap ─────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') { this.shiftHeld = true; this.applySnapPolicy(); }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') { this.shiftHeld = false; this.applySnapPolicy(); }
  };

  /**
   * Mirrors the 2D canvas's zoom-tiered snap policy: close orbit distance ("near")
   * disables auto-snap (Shift forces it on); far orbit distance auto-snaps, growing
   * from the fine per-axis grid to a coarse 0.5m grid, with Shift inverting (off).
   * Rotation stays pure Shift-snap, independent of zoom. Translation snapping is
   * NOT delegated to TransformControls: the raw delta must reach onDragMove so the
   * consumer can resolve alignment guides vs. grid per axis (getTranslateSnapSpacing).
   */
  private applySnapPolicy(): void {
    this.gizmo.setRotationSnap(this.shiftHeld ? MathUtils.degToRad(ROTATE_SNAP_DEG) : null);
  }

  /** The zoom-tiered translate grid spacing in meters, or null when snapping is off. */
  getTranslateSnapSpacing(): number | null {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const tier: ZoomTier = distance < NEAR_ZOOM_DISTANCE_METERS
      ? 'near'
      : distance > FAR_ZOOM_DISTANCE_METERS ? 'far' : 'mid';
    return resolveSnapSpacing(tier, this.shiftHeld, TRANSLATE_SNAP_METERS, COARSE_SNAP_METERS);
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downOnGizmo = this.gizmo.axis !== null;

    // Shift-drag → line-select tool, mirrors the 2D canvas. Takes priority over
    // orbiting so a shift-drag never rotates the camera instead of drawing a line.
    if (e.button === 0 && e.shiftKey && !this.downOnGizmo) {
      const rect = this.canvas.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.lineDragging = true;
      this.lineStart = p;
      this.lineEnd = { ...p };
      this.orbit.enabled = false;
      this.callbacks.onLineDrag?.({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    } else if (e.button === 0 && (e.ctrlKey || e.metaKey) && !this.downOnGizmo) {
      // Ctrl/Cmd-drag → box-select tool. Same priority-over-orbiting rule as
      // the shift-drag line-select above.
      const rect = this.canvas.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.boxDragging = true;
      this.boxStart = p;
      this.boxEnd = { ...p };
      this.orbit.enabled = false;
      this.callbacks.onBoxDrag?.({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.lineDragging) {
      const rect = this.canvas.getBoundingClientRect();
      this.lineEnd = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.callbacks.onLineDrag?.({ x1: this.lineStart.x, y1: this.lineStart.y, x2: this.lineEnd.x, y2: this.lineEnd.y });
    } else if (this.boxDragging) {
      const rect = this.canvas.getBoundingClientRect();
      this.boxEnd = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.callbacks.onBoxDrag?.({ x1: this.boxStart.x, y1: this.boxStart.y, x2: this.boxEnd.x, y2: this.boxEnd.y });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    if (this.lineDragging) {
      this.lineDragging = false;
      this.orbit.enabled = true;
      this.callbacks.onLineDrag?.(null);
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_MOVE_THRESHOLD_PX;
      if (moved) {
        // Shift-DRAG → line-select the fixtures the drawn line crosses.
        this.callbacks.onLineSelect?.(this.hitTestLine(this.lineStart, this.lineEnd), e);
      } else {
        // Shift-CLICK (no drag) → list-style range select on the fixture hit.
        this.callbacks.onShiftClick?.(this.raycastFixtureAt(e) ?? null, e);
      }
      return;
    }

    if (this.boxDragging) {
      this.boxDragging = false;
      this.orbit.enabled = true;
      this.callbacks.onBoxDrag?.(null);
      const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_MOVE_THRESHOLD_PX;
      if (moved) {
        // Ctrl/Cmd-DRAG → box-select every fixture inside the drawn rect.
        this.callbacks.onBoxSelect?.(this.hitTestBox(this.boxStart, this.boxEnd), e);
      } else {
        // Ctrl/Cmd-CLICK (no drag) → plain additive click select.
        this.callbacks.onSelect(this.raycastFixtureAt(e) ?? null, e);
      }
      return;
    }

    if (this.downOnGizmo || this.dragging || this.gizmo.axis !== null) return;
    // Ignore orbit drags — only treat near-stationary pointer ups as clicks.
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_MOVE_THRESHOLD_PX) return;

    this.callbacks.onSelect(this.raycastFixtureAt(e) ?? null, e);
  };

  /** Raycasts the fixture instance under a pointer event, if any. */
  private raycastFixtureAt(e: PointerEvent): string | number | undefined {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    // Bodies (instanced boxes) plus kind body meshes (polyline tubes, flat
    // shapes), so clicking anywhere on a kind fixture's body selects it.
    const targets = [this.bodies.mesh, this.polylines.mesh, this.shapes.mesh].filter(m => m.visible);
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      if (hit.object === this.bodies.mesh && hit.instanceId !== undefined) {
        return this.bodies.fixtureIdAt(hit.instanceId);
      }
      if (hit.faceIndex != null) {
        const owner = hit.object === this.polylines.mesh ? this.polylines : hit.object === this.shapes.mesh ? this.shapes : null;
        const id = owner?.fixtureIdAtFace(hit.faceIndex);
        if (id !== undefined) return id;
      }
    }
    return undefined;
  }

  /** Projects a world position to canvas CSS-pixels; `visible` is false when it's behind the camera. */
  private projectToScreen(pos: Vector3, rect: DOMRect): { x: number; y: number; visible: boolean } {
    const p = pos.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, visible: p.z <= 1 };
  }

  // ── Alignment guides ────────────────────────────────────────────────────────

  /** Fixture ids whose centers project inside the current canvas viewport. */
  getVisibleFixtureIds(): Set<string | number> {
    const rect = this.canvas.getBoundingClientRect();
    const visible = new Set<string | number>();
    for (const model of this.bodies.fixtureModels) {
      const s = this.projectToScreen(model.position, rect);
      if (s.visible && s.x >= 0 && s.x <= rect.width && s.y >= 0 && s.y <= rect.height) {
        visible.add(model.fixtureId);
      }
    }
    return visible;
  }

  /** Projects world meters to canvas CSS-pixels — for DOM overlays (guide distance labels). */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    return this.projectToScreen(new Vector3(x, y, z), this.canvas.getBoundingClientRect());
  }

  /**
   * World meters covered by one CSS pixel at the gizmo pivot's depth — converts
   * the screen-constant alignment tolerance into meters for the current view.
   */
  getWorldPerPixel(): number {
    const distance = this.camera.position.distanceTo(this.pivot.position);
    return (2 * distance * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) / this.canvas.clientHeight;
  }

  /**
   * Which world axes the grabbed gizmo handle actually moves — [x, y, z].
   * Falls back to all-active when no handle is grabbed (shouldn't happen
   * mid-drag, but keeps callers from locking everything).
   */
  getActiveDragAxes(): boolean[] {
    const axis = this.gizmo.axis ?? '';
    const flags = [axis.includes('X'), axis.includes('Y'), axis.includes('Z')];
    return flags.some(Boolean) ? flags : [true, true, true];
  }

  /** Draws (or clears, with null) the live alignment guide lines in the scene. */
  setAlignmentGuides(data: AlignmentGuideData | null): void {
    this.alignGuides.update(data, this.getWorldPerPixel());
  }

  /** Projects every fixture's 3D position to canvas CSS-pixels and picks those near the drawn line — same math as the 2D line-select tool. */
  private hitTestLine(start: { x: number; y: number }, end: { x: number; y: number }): Set<string | number> {
    const rect = this.canvas.getBoundingClientRect();
    const hit = new Set<string | number>();
    for (const model of this.bodies.fixtureModels) {
      const s = this.projectToScreen(model.position, rect);
      if (!s.visible) continue;
      if (distanceToSegment(s.x, s.y, start.x, start.y, end.x, end.y) <= LINE_SELECT_PICKUP_PX) {
        hit.add(model.fixtureId);
      }
    }
    return hit;
  }

  /** Projects every fixture's 3D position to canvas CSS-pixels and picks those inside the drawn rect — the box-select analogue of hitTestLine. */
  private hitTestBox(start: { x: number; y: number }, end: { x: number; y: number }): Set<string | number> {
    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
    const hit = new Set<string | number>();
    for (const model of this.bodies.fixtureModels) {
      const s = this.projectToScreen(model.position, rect);
      if (!s.visible) continue;
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) hit.add(model.fixtureId);
    }
    return hit;
  }

  /**
   * Selects every fixture lying on the virtual ray between two fixtures — the
   * 3D analogue of the 2D canvas's Shift-click ray. Endpoints are the two
   * fixtures' projected screen positions; hits are tested in screen space so it
   * matches what the user sees from the current camera angle.
   */
  selectAlongRay(anchorId: string | number, targetId: string | number): Set<string | number> {
    const models = this.bodies.fixtureModels;
    const a = models.find(m => m.fixtureId === anchorId);
    const b = models.find(m => m.fixtureId === targetId);
    if (!a || !b) return new Set([targetId]);
    const rect = this.canvas.getBoundingClientRect();
    const pa = this.projectToScreen(a.position, rect);
    const pb = this.projectToScreen(b.position, rect);
    return this.hitTestLine({ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y });
  }

  setSelection(ids: Set<string | number>): void {
    this.selectedIds = new Set(ids);
    this.bodies.setSelection(this.selectedIds);
    this.beams.setSelection(this.selectedIds);
    this.polylines.setSelection(this.selectedIds);
    this.shapes.setSelection(this.selectedIds);
    this.refreshPivot();
  }

  /** Places the gizmo pivot at the selection centroid (identity rotation). */
  private refreshPivot(): void {
    if (this.dragging) return;
    const models = this.bodies.fixtureModels.filter(m => this.selectedIds.has(m.fixtureId));
    if (models.length === 0) {
      this.gizmo.enabled = false;
      this.gizmo.getHelper().visible = false;
      return;
    }
    const centroid = new Vector3();
    for (const m of models) centroid.add(m.position);
    centroid.divideScalar(models.length);
    this.pivot.position.copy(centroid);
    this.pivot.rotation.set(0, 0, 0);
    this.gizmo.enabled = true;
    this.gizmo.getHelper().visible = true;
  }

  // ── Pan / zoom (wheel) ──────────────────────────────────────────────────────

  /**
   * Mirrors the 2D canvas's wheel convention (use-camera.ts onWheel): a plain
   * wheel event — including a trackpad's two-finger swipe, which fires as
   * wheel rather than touch — pans the current view plane; Ctrl/Cmd+wheel
   * (pinch-to-zoom on a trackpad) dollies the camera instead. Handled here
   * rather than via OrbitControls' own wheel binding (disabled above) since
   * that binding always zooms and can't distinguish the two gestures.
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Deltas normalized to pixels (Firefox reports mouse wheels in lines) and
    // negated so the scene follows the fingers — same feel as the 2D canvas,
    // where swiping right moves the content right (camera.x -= deltaX).
    const { dx, dy } = normalizeWheelDelta(e);
    if (e.ctrlKey || e.metaKey) this.dollyBy(-dy);
    else this.panByPixels(-dx, -dy);
  };

  /** Moves the camera toward/away from the orbit target, clamped to the configured zoom range. deltaY < 0 zooms out. */
  private dollyBy(deltaY: number): void {
    const factor = Math.pow(0.95, deltaY * 0.05);
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const distance = MathUtils.clamp(offset.length() * factor, this.orbit.minDistance, this.orbit.maxDistance);
    this.camera.position.copy(this.orbit.target).add(offset.setLength(distance));
  }

  /** Screen-space pan — same formula as OrbitControls' internal pointer-drag pan, driven by wheel deltas instead of pointer movement. */
  private panByPixels(dx: number, dy: number): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const targetDistance = offset.length() * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    const panLeftDist = (2 * dx * targetDistance) / this.canvas.clientHeight;
    const panUpDist = (2 * dy * targetDistance) / this.canvas.clientHeight;
    const xColumn = new Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const yColumn = new Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const panOffset = xColumn.multiplyScalar(-panLeftDist).add(yColumn.multiplyScalar(panUpDist));
    this.camera.position.add(panOffset);
    this.orbit.target.add(panOffset);
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
    this.applySnapPolicy();
  }

  get gizmoMode(): GizmoMode {
    return this.gizmo.mode as GizmoMode;
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  rebuild(): void {
    const model = buildSceneModel(this.callbacks.getFixtures());
    this.pixels.rebuild(model.pixels);
    this.beams.rebuild(model.beams);
    this.bodies.rebuild(model.bodies);
    this.polylines.rebuild(model.polylines);
    this.shapes.rebuild(model.shapes);
    this.svgPlanes.rebuild(model.svgPlanes);
    this.bodies.setSelection(this.selectedIds);
    this.beams.setSelection(this.selectedIds);
    this.polylines.setSelection(this.selectedIds);
    this.shapes.setSelection(this.selectedIds);
    this.refreshPivot();
    this.updateStageToFit(model.bodies);
  }

  /** Grows/shrinks the floor so it always extends FLOOR_MARGIN_METERS past the fixture bounding box. */
  private updateStageToFit(bodies: BodyModel[]): void {
    if (bodies.length === 0) {
      this.stage.update(FLOOR_MIN_SIZE_METERS, FLOOR_MIN_SIZE_METERS, 0, 0);
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of bodies) {
      if (b.position.x < minX) minX = b.position.x;
      if (b.position.x > maxX) maxX = b.position.x;
      if (b.position.z < minZ) minZ = b.position.z;
      if (b.position.z > maxZ) maxZ = b.position.z;
    }
    const width = Math.max(maxX - minX + FLOOR_MARGIN_METERS * 2, FLOOR_MIN_SIZE_METERS);
    const depth = Math.max(maxZ - minZ + FLOOR_MARGIN_METERS * 2, FLOOR_MIN_SIZE_METERS);
    this.stage.update(width, depth, (minX + maxX) / 2, (minZ + maxZ) / 2);
  }

  // ── Render loop ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const dmx = this.callbacks.getDmx();
      const tSec = (this.callbacks.getElapsed?.() ?? 0) / 1000;
      this.pixels.updateColors(dmx, tSec);
      this.beams.update(dmx, tSec);
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) this.stop();
  };

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.pixels.setPixelScale(
      (height * this.renderer.getPixelRatio()) /
        (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)),
    );
  }

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.pixels.dispose();
    this.beams.dispose();
    this.bodies.dispose();
    this.polylines.dispose();
    this.shapes.dispose();
    this.svgPlanes.dispose();
    this.alignGuides.dispose();
    this.stage.dispose();
    this.renderer.dispose();
  }
}
