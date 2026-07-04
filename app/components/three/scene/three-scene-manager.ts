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
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Fixture } from '~/utils/engine/core/fixture';
import { buildSceneModel, type BodyModel } from './fixture-adapter';
import { PixelCloud } from './pixel-instances';
import { BeamCones } from './beam-cones';
import { FixtureBodies } from './fixture-bodies';
import { buildStage, type Stage } from './stage';
import {
  FLOOR_MARGIN_METERS,
  FLOOR_MIN_SIZE_METERS,
  NEAR_ZOOM_DISTANCE_METERS,
  FAR_ZOOM_DISTANCE_METERS,
  COARSE_SNAP_METERS,
} from '~/utils/engine/constants';
import { resolveSnapSpacing, type ZoomTier } from '~/utils/engine/snap-policy';

export type GizmoMode = 'translate' | 'rotate';

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
  /** Non-reactive accessor for the (raw, un-proxied) fixture list. */
  getFixtures: () => Fixture[];
  /** Click selection. id === null → clicked empty space. */
  onSelect: (id: string | number | null, additive: boolean) => void;
  onDragStart: () => void;
  /** Fired continuously during a gizmo drag with the total delta since drag start. */
  onDragMove: (mode: GizmoMode, delta: TransformDelta) => void;
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
  private stage: Stage;

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
    this.orbit.addEventListener('change', () => this.applySnapPolicy());

    this.beams = new BeamCones(this.scene);
    this.bodies = new FixtureBodies(this.scene);
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
      this.callbacks.onDragMove(this.gizmo.mode as GizmoMode, delta);
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
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
   * Rotation stays pure Shift-snap, independent of zoom.
   */
  private applySnapPolicy(): void {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const tier: ZoomTier = distance < NEAR_ZOOM_DISTANCE_METERS
      ? 'near'
      : distance > FAR_ZOOM_DISTANCE_METERS ? 'far' : 'mid';
    const translateSnap = resolveSnapSpacing(tier, this.shiftHeld, TRANSLATE_SNAP_METERS, COARSE_SNAP_METERS);
    this.gizmo.setTranslationSnap(translateSnap);
    this.gizmo.setRotationSnap(this.shiftHeld ? MathUtils.degToRad(ROTATE_SNAP_DEG) : null);
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downOnGizmo = this.gizmo.axis !== null;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.downOnGizmo || this.dragging || this.gizmo.axis !== null) return;
    // Ignore orbit drags — only treat near-stationary pointer ups as clicks.
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) return;

    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.bodies.mesh, false);
    const hit = hits.find(h => h.instanceId !== undefined);
    const id = hit ? this.bodies.fixtureIdAt(hit.instanceId!) : undefined;
    this.callbacks.onSelect(id ?? null, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  setSelection(ids: Set<string | number>): void {
    this.selectedIds = new Set(ids);
    this.bodies.setSelection(this.selectedIds);
    this.beams.setSelection(this.selectedIds);
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
    this.bodies.setSelection(this.selectedIds);
    this.beams.setSelection(this.selectedIds);
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
      this.pixels.updateColors(dmx);
      this.beams.update(dmx);
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
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.pixels.dispose();
    this.beams.dispose();
    this.bodies.dispose();
    this.stage.dispose();
    this.renderer.dispose();
  }
}
