import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { BeamModel } from './fixture-adapter';
import type { MovingHeadDims } from './moving-head-geometry';
import { createBeamMaterial } from './beam-material';
import { resolvePhotometricInto } from '~/utils/engine/core/photometry';
import { axisAngleDeg } from '~/utils/engine/core/motion-range';

const DEG2RAD = Math.PI / 180;
/** Beam length in meters — clipped by the floor's depth buffer anyway. */
const BEAM_LENGTH = 25;

// Housing colors (lit) — slightly lighter than the unlit-era box so the
// Lambert shading has room; selection matches the 2D canvas (#fbbf24).
const HOUSING_COLOR = new Color(0x3a3a44);
const HOUSING_SELECTED_COLOR = new Color(0xfbbf24);
// Dark glass when the lens emits nothing (sRGB 0…1, like the photometry output).
const LENS_OFF_SRGB = 0.05;

interface BeamRig {
  model: BeamModel;
  base: Group;
  panPivot: Group;
  tiltPivot: Group;
  cone: Mesh;
  material: ShaderMaterial;
  /** Shared by every housing part of the rig (yoke, head) for selection tint. */
  housingMaterial: MeshLambertMaterial;
  /** Moving-head lens, colored by the beam each frame; null for plain cones. */
  lensMaterial: MeshBasicMaterial | null;
}

/**
 * Unit cone: apex at the origin, opening down -Y over y ∈ [-1, 0], base
 * radius 1. Per frame it is scaled to (tan(halfAngle)·L, L, tan(halfAngle)·L).
 */
function createUnitConeGeometry(): CylinderGeometry {
  const geo = new CylinderGeometry(0.02, 1, 1, 32, 12, true);
  geo.translate(0, -0.5, 0);
  return geo;
}

/** Unit geometries shared by all rigs; meshes scale them per fixture. */
class RigGeometries {
  readonly cone = createUnitConeGeometry();
  readonly box = new BoxGeometry(1, 1, 1);
  readonly cylinder = new CylinderGeometry(1, 1, 1, 32);
  /** Head barrel, front (+Y, lens side) slightly wider than the back. */
  readonly headBarrel = new CylinderGeometry(1, 0.86, 1, 32);
  /** Tilt bearing hub, axis along X. */
  readonly hub = new CylinderGeometry(1, 1, 1, 24).rotateZ(Math.PI / 2);
  /** Lens disc facing +Y. */
  readonly lens = new CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  /** Small spot head box (PARs / simple spots). */
  readonly spotHead = new BoxGeometry(0.24, 0.3, 0.24);

  dispose(): void {
    for (const g of [this.cone, this.box, this.cylinder, this.headBarrel, this.hub, this.lens, this.spotHead]) g.dispose();
  }
}

/** Mesh of `geometry` scaled to (sx, sy, sz) at (x, y, z), added to `parent`. */
function part(
  parent: Group,
  geometry: BoxGeometry | CylinderGeometry | CircleGeometry,
  material: MeshLambertMaterial | MeshBasicMaterial,
  scale: [number, number, number],
  pos: [number, number, number],
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(...scale);
  mesh.position.set(...pos);
  parent.add(mesh);
  return mesh;
}

/**
 * Yoke (rotates with pan) and head (rotates with tilt) of the procedural
 * moving-head model; the base is the fixture's body box (fixture-bodies.ts).
 * Returns the lens material, which `update` colors per frame.
 */
function buildMovingHead(
  geo: RigGeometries,
  d: MovingHeadDims,
  panPivot: Group,
  tiltPivot: Group,
  housing: MeshLambertMaterial,
): MeshBasicMaterial {
  // Pan bearing between base and yoke.
  part(panPivot, geo.cylinder, housing,
    [d.bearingRadius, d.bearingHeight, d.bearingRadius], [0, d.baseHeight + d.bearingHeight / 2, 0]);

  // U-shaped yoke: crossbar + two arms reaching past the tilt axis.
  part(panPivot, geo.box, housing,
    [d.width, d.crossbarHeight, d.crossbarDepth], [0, d.crossbarTop - d.crossbarHeight / 2, 0]);
  const armBottom = d.crossbarTop - d.crossbarHeight;
  const armTop = d.tiltAxisY + d.headRadius * 0.55;
  for (const side of [-1, 1]) {
    part(panPivot, geo.box, housing,
      [d.armThickness, armTop - armBottom, d.armDepth], [side * d.armX, (armBottom + armTop) / 2, 0]);
    // Tilt bearing hub on the outside of each arm.
    const hubLen = d.width * 0.04;
    part(panPivot, geo.hub, housing,
      [hubLen, d.headRadius * 0.4, d.headRadius * 0.4], [side * (d.width / 2 + hubLen / 2), d.tiltAxisY, 0]);
  }

  // Head barrel centered on the tilt axis, lens on its front (+Y) face.
  tiltPivot.position.y = d.tiltAxisY;
  part(tiltPivot, geo.headBarrel, housing, [d.headRadius, d.headLength, d.headRadius], [0, 0, 0]);
  const lensMaterial = new MeshBasicMaterial({ toneMapped: false });
  lensMaterial.color.setRGB(LENS_OFF_SRGB, LENS_OFF_SRGB, LENS_OFF_SRGB, SRGBColorSpace);
  part(tiltPivot, geo.lens, lensMaterial, [d.lensRadius, 1, d.lensRadius], [0, d.headLength / 2 + 0.002, 0]);
  return lensMaterial;
}

/**
 * Volumetric beam cones for moving heads / spots, plus the procedural
 * moving-head model. One small object hierarchy per beam (dozens at most —
 * no instancing needed):
 *   base (fixture origin + mounting euler) → panPivot (Y) → tiltPivot (X) → cone
 *
 * Neutral pose (pan/tilt at their DMX midpoint, or no channel): the beam
 * points along the fixture's local +Y, i.e. away from the mounting plane —
 * up for a floor-standing fixture, down when the fixture's Tilt is 180°.
 */
export class BeamCones {
  private rigs: BeamRig[] = [];
  private geo = new RigGeometries();
  private tmpDir = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpColor = new Float32Array(3);
  /**
   * Housing meshes (yoke, head, lens, spot head) as raycast targets, mapped
   * to their fixture — so a moving head is selectable by its whole model, not
   * just the base box. The beam cone is excluded: clicking into light
   * shouldn't select the fixture.
   */
  readonly pickTargets: Mesh[] = [];
  private pickOwner = new Map<Mesh, string | number>();

  constructor(private scene: Scene) {}

  /** Fixture owning a housing mesh hit by a raycast. */
  fixtureIdOf(mesh: unknown): string | number | undefined {
    return this.pickOwner.get(mesh as Mesh);
  }

  rebuild(models: BeamModel[]): void {
    this.disposeRigs();

    for (const model of models) {
      const base = new Group();
      base.position.copy(model.position);
      base.rotation.copy(model.euler);

      const panPivot = new Group();
      const tiltPivot = new Group();
      base.add(panPivot);
      panPivot.add(tiltPivot);

      // Own housing material per rig (not instanced) so selection can tint it.
      const housingMaterial = new MeshLambertMaterial({ color: HOUSING_COLOR.clone() });
      let lensMaterial: MeshBasicMaterial | null = null;
      if (model.movingHead) {
        lensMaterial = buildMovingHead(this.geo, model.movingHead, panPivot, tiltPivot, housingMaterial);
      } else if (model.showHead) {
        tiltPivot.add(new Mesh(this.geo.spotHead, housingMaterial));
      }

      const material = createBeamMaterial();
      const cone = new Mesh(this.geo.cone, material);
      // Flip the unit cone (opens -Y) to open along +Y, starting at the lens.
      cone.rotation.x = Math.PI;
      cone.position.y = model.movingHead ? model.movingHead.headLength / 2 + 0.004 : 0;
      cone.renderOrder = 10;
      cone.frustumCulled = false;
      tiltPivot.add(cone);

      // Every housing part picks the fixture (see `pickTargets`).
      base.traverse((o) => {
        if (o instanceof Mesh && o !== cone) {
          this.pickTargets.push(o);
          this.pickOwner.set(o, model.fixtureId);
        }
      });

      this.scene.add(base);
      this.rigs.push({ model, base, panPivot, tiltPivot, cone, material, housingMaterial, lensMaterial });
    }
  }

  /** Tints each rig's housing to match the selection highlight. */
  setSelection(selected: Set<string | number>): void {
    for (const rig of this.rigs) {
      rig.housingMaterial.color.copy(selected.has(rig.model.fixtureId) ? HOUSING_SELECTED_COLOR : HOUSING_COLOR);
    }
  }

  /** Per-frame: pan/tilt pose, cone angle, color × dimmer × shutter intensity. */
  update(dmx: Uint8Array, tSec: number): void {
    for (const rig of this.rigs) {
      const m = rig.model;

      // Normalized position 0…1 (16-bit when a fine channel exists).
      const read16 = (idx: number, fineIdx: number): number => {
        const coarse = dmx[idx] ?? 0;
        if (fineIdx >= 0) return ((coarse << 8) | (dmx[fineIdx] ?? 0)) / 65535;
        return coarse / 255;
      };

      // Angles relative to the range center — DMX midpoint = neutral pose.
      rig.panPivot.rotation.y = m.panIdx >= 0
        ? axisAngleDeg(m.panRange, read16(m.panIdx, m.panFineIdx)) * DEG2RAD
        : 0;
      rig.tiltPivot.rotation.x = m.hasTilt
        ? axisAngleDeg(m.tiltRange, read16(m.tiltIdx, m.tiltFineIdx)) * DEG2RAD
        : 0;

      // Cone angle: ZOOM/BEAM_ANGLE lerped over the lens range.
      const zoomT = m.zoomIdx >= 0 ? (dmx[m.zoomIdx] ?? 0) / 255 : 0;
      const angleDeg = m.beamAngleMinDeg + (m.beamAngleMaxDeg - m.beamAngleMinDeg) * zoomT;
      const halfAngle = Math.max(0.5, angleDeg / 2) * DEG2RAD;
      const radius = Math.tan(halfAngle) * BEAM_LENGTH;
      rig.cone.scale.set(radius, BEAM_LENGTH, radius);

      // Color × dimmer × shutter gate, same canonical formula as the pixel
      // hot loop (photometry.ts). Color wheels contribute their slot color
      // at full brightness — they never scale intensity.
      resolvePhotometricInto(m.photometry, dmx, tSec, this.tmpColor, 0);
      const r = this.tmpColor[0]!;
      const g = this.tmpColor[1]!;
      const b = this.tmpColor[2]!;
      const intensity = Math.max(r, g, b);

      // Lens glows in the beam color, dark glass when off. The photometry
      // output is raw display color (like the pixel shader) → sRGB.
      rig.lensMaterial?.color.setRGB(
        Math.max(LENS_OFF_SRGB, r), Math.max(LENS_OFF_SRGB, g), Math.max(LENS_OFF_SRGB, b), SRGBColorSpace,
      );

      if (intensity <= 0.004) {
        rig.cone.visible = false;
        continue;
      }
      rig.cone.visible = true;
      const u = rig.material.uniforms;
      u.uColor!.value.setRGB(r, g, b);
      u.uIntensity!.value = Math.min(1, intensity);
      // World-space beam axis for the barrel fade (unit cone opens along local -Y).
      this.tmpDir.set(0, -1, 0).applyQuaternion(rig.cone.getWorldQuaternion(this.tmpQuat));
      u.uBeamDirW!.value.copy(this.tmpDir);
    }
  }

  /** Removes every rig and frees its per-rig materials (geometries are shared). */
  private disposeRigs(): void {
    for (const rig of this.rigs) {
      this.scene.remove(rig.base);
      rig.material.dispose();
      rig.housingMaterial.dispose();
      rig.lensMaterial?.dispose();
    }
    this.rigs = [];
    this.pickTargets.length = 0;
    this.pickOwner.clear();
  }

  dispose(): void {
    this.disposeRigs();
    this.geo.dispose();
  }
}
