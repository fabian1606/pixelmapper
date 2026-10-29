import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { SegmentModel } from './fixture-adapter';
import { resolvePhotometricInto } from '~/utils/engine/core/photometry';

// Unlit segment tint — slightly lighter than the body box so the emitting
// face stays readable while dark.
const UNLIT_COLOR = new Color(0x3a3a44);

// instanceMatrix / instanceColor are declared by three's ShaderMaterial
// prefix (USE_INSTANCING / USE_INSTANCING_COLOR).
const VERT = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

// Raw photometric color like the pixel cloud (no tone mapping / color
// space conversion), so dots, segments and cones read as the same light.
const FRAG = /* glsl */ `
  uniform vec3 uUnlit;
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(uUnlit + vColor, 1.0);
  }
`;

/**
 * Emitting face of multi-head fixtures (LED bars, matrices): one flat quad
 * per head on the body's top face, filled with that head's live color each
 * frame — makes pixel effects (chases, gradients) readable along the bar.
 * Pure visual: not a raycast target, the body box handles selection.
 */
export class PixelSegments {
  private mesh: InstancedMesh;
  private models: SegmentModel[] = [];
  // Unit quad facing +Y (local "up" of the fixture).
  private geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uUnlit: { value: UNLIT_COLOR } },
    side: DoubleSide,
    toneMapped: false,
  });
  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();
  private tmpColor = new Color();

  constructor(private scene: Scene) {
    this.mesh = this.createMesh(0);
  }

  /** Fresh instanced mesh with an allocated instanceColor buffer. */
  private createMesh(count: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, count);
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    // Allocates instanceColor so USE_INSTANCING_COLOR is defined.
    for (let i = 0; i < count; i++) mesh.setColorAt(i, this.tmpColor.setRGB(0, 0, 0));
    this.scene.add(mesh);
    return mesh;
  }

  rebuild(models: SegmentModel[]): void {
    this.models = models;
    if (this.mesh.count !== models.length) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.createMesh(models.length);
    }
    this.mesh.visible = models.length > 0;

    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      this.tmpQuat.setFromEuler(m.euler);
      this.tmpScale.set(m.width, 1, m.depth);
      this.tmpMatrix.compose(m.position, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(i, this.tmpMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Per-frame hot loop: DMX buffer → per-segment color. No allocations. */
  updateColors(dmx: Uint8Array, tSec: number): void {
    const attr = this.mesh.instanceColor;
    if (!attr || this.models.length === 0) return;
    const out = attr.array as Float32Array;
    for (let i = 0; i < this.models.length; i++) {
      resolvePhotometricInto(this.models[i]!.photometry, dmx, tSec, out, i * 3);
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
