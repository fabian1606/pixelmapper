import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
} from 'three';
import type { PixelModel } from './fixture-adapter';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uPixelScale; // viewport height in px / (2 * tan(fov/2))

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Perspective size attenuation: world-diameter aSize projected to pixels.
    gl_PointSize = clamp(aSize * uPixelScale / max(0.001, -mv.z), 2.0, 128.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;          // 0 center → 1 edge
    if (d > 1.0) discard;
    float core = pow(max(0.0, 1.0 - d), 3.0);   // hot center
    float halo = smoothstep(1.0, 0.35, d) * 0.5;
    vec3 c = vColor * (core * 2.2 + halo);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * All LED pixels of the whole scene as one THREE.Points draw call.
 * Geometry is rebuilt on layout changes; only aColor is touched per frame.
 */
export class PixelCloud {
  readonly points: Points;
  private geometry: BufferGeometry;
  private material: ShaderMaterial;
  private model: PixelModel | null = null;
  private colorAttr: BufferAttribute | null = null;

  constructor() {
    this.geometry = new BufferGeometry();
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uPixelScale: { value: 1 } },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** viewportHeightPx / (2 * tan(fovRad / 2)) — recompute on resize/fov change. */
  setPixelScale(scale: number): void {
    this.material.uniforms.uPixelScale!.value = scale;
  }

  rebuild(model: PixelModel): void {
    this.model = model;
    const samePixelCount =
      this.colorAttr !== null &&
      this.geometry.getAttribute('position')?.count === model.count;

    if (samePixelCount) {
      // Drag path: positions/sizes changed, topology didn't — update in place.
      (this.geometry.getAttribute('position') as BufferAttribute).copyArray(model.positions).needsUpdate = true;
      (this.geometry.getAttribute('aSize') as BufferAttribute).copyArray(model.sizes).needsUpdate = true;
      return;
    }

    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    this.geometry.setAttribute('aSize', new BufferAttribute(model.sizes, 1));
    this.colorAttr = new BufferAttribute(new Float32Array(model.count * 3), 3);
    this.colorAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.points.geometry = this.geometry;
  }

  /** Per-frame hot loop: DMX buffer → per-pixel color. No allocations. */
  updateColors(dmx: Uint8Array): void {
    const m = this.model;
    const attr = this.colorAttr;
    if (!m || !attr) return;
    const out = attr.array as Float32Array;
    const { entryStart, chanIdx, weights, dimmerIdx } = m;
    for (let p = 0; p < m.count; p++) {
      const di = dimmerIdx[p]!;
      const dim = di >= 0 ? (dmx[di] ?? 0) / 255 : 1;
      let r = 0;
      let g = 0;
      let b = 0;
      const end = entryStart[p + 1]!;
      for (let e = entryStart[p]!; e < end; e++) {
        const w = (dmx[chanIdx[e]!] ?? 0) / 255;
        r += weights[e * 3]! * w;
        g += weights[e * 3 + 1]! * w;
        b += weights[e * 3 + 2]! * w;
      }
      out[p * 3] = r * dim;
      out[p * 3 + 1] = g * dim;
      out[p * 3 + 2] = b * dim;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
