import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BeamModel } from './fixture-adapter';
import { createBeamMaterial } from './beam-material';
import { resolvePhotometricInto } from '~/utils/engine/core/photometry';

const DEG2RAD = Math.PI / 180;
/** Beam length in meters — clipped by the floor's depth buffer anyway. */
const BEAM_LENGTH = 25;

// Matches the fixture body box + 2D canvas selection color.
const HEAD_BASE_COLOR = new Color(0x18181d);
const HEAD_SELECTED_COLOR = new Color(0xfbbf24);

interface BeamRig {
  model: BeamModel;
  base: Group;
  panPivot: Group;
  tiltPivot: Group;
  cone: Mesh;
  material: ShaderMaterial;
  head: Mesh;
  headMaterial: MeshBasicMaterial;
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

/**
 * Volumetric beam cones for moving heads / spots. One small object hierarchy
 * per beam fixture (dozens at most — no instancing needed):
 *   base (fixture pos + mounting euler) → panPivot (Y) → tiltPivot (X) → cone
 */
export class BeamCones {
  private rigs: BeamRig[] = [];
  private coneGeometry = createUnitConeGeometry();
  private headGeometry = new BoxGeometry(0.24, 0.3, 0.24);
  private tmpDir = new Vector3();
  private tmpQuat = new Quaternion();

  constructor(private scene: Scene) {}

  rebuild(models: BeamModel[]): void {
    for (const rig of this.rigs) {
      this.scene.remove(rig.base);
      rig.material.dispose();
      rig.headMaterial.dispose();
    }
    this.rigs = [];

    for (const model of models) {
      const base = new Group();
      base.position.copy(model.position);
      base.rotation.copy(model.euler);

      const panPivot = new Group();
      const tiltPivot = new Group();
      base.add(panPivot);
      panPivot.add(tiltPivot);

      // Own material per head (not instanced) so selection can tint it.
      const headMaterial = new MeshBasicMaterial({ color: HEAD_BASE_COLOR });
      const head = new Mesh(this.headGeometry, headMaterial);
      tiltPivot.add(head);

      const material = createBeamMaterial();
      const cone = new Mesh(this.coneGeometry, material);
      cone.renderOrder = 10;
      cone.frustumCulled = false;
      tiltPivot.add(cone);

      this.scene.add(base);
      this.rigs.push({ model, base, panPivot, tiltPivot, cone, material, head, headMaterial });
    }
  }

  /** Tints each beam fixture's head box to match the selection highlight. */
  setSelection(selected: Set<string | number>): void {
    for (const rig of this.rigs) {
      rig.headMaterial.color.copy(selected.has(rig.model.fixtureId) ? HEAD_SELECTED_COLOR : HEAD_BASE_COLOR);
    }
  }

  private tmpColor = new Float32Array(3);

  /** Per-frame: pan/tilt rotation, cone angle, color × dimmer × shutter intensity. */
  update(dmx: Uint8Array, tSec: number): void {
    for (const rig of this.rigs) {
      const m = rig.model;

      const read16 = (idx: number, fineIdx: number): number => {
        if (idx < 0) return 0.5; // no channel → center position
        const coarse = dmx[idx] ?? 0;
        if (fineIdx >= 0) return ((coarse << 8) | (dmx[fineIdx] ?? 0)) / 65535;
        return coarse / 255;
      };

      const pan = read16(m.panIdx, m.panFineIdx);
      rig.panPivot.rotation.y = (pan - 0.5) * m.panRangeDeg * DEG2RAD;
      if (m.hasTilt) {
        const tilt = read16(m.tiltIdx, m.tiltFineIdx);
        rig.tiltPivot.rotation.x = (tilt - 0.5) * m.tiltRangeDeg * DEG2RAD;
      } else {
        // No tilt channel: point up (uplight convention) so a fixture sitting
        // on the floor doesn't fire its cone straight into the floor plane.
        // The fixture's Tilt field (base euler) reorients it freely.
        rig.tiltPivot.rotation.x = Math.PI;
      }

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

      if (intensity <= 0.004) {
        rig.cone.visible = false;
        continue;
      }
      rig.cone.visible = true;
      const u = rig.material.uniforms;
      u.uColor!.value.setRGB(r, g, b);
      u.uIntensity!.value = Math.min(1, intensity);
      // World-space beam axis for the barrel fade.
      this.tmpDir.set(0, -1, 0).applyQuaternion(rig.cone.getWorldQuaternion(this.tmpQuat));
      u.uBeamDirW!.value.copy(this.tmpDir);
    }
  }

  dispose(): void {
    for (const rig of this.rigs) {
      this.scene.remove(rig.base);
      rig.material.dispose();
      rig.headMaterial.dispose();
    }
    this.rigs = [];
    this.coneGeometry.dispose();
    this.headGeometry.dispose();
  }
}
