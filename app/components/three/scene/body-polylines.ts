import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Mesh,
  MeshBasicMaterial,
  Scene,
  TubeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PolylineModel } from './fixture-adapter';

// Matches the 2D default polyline stroke rgba(40,40,40) — visible against
// the near-black floor so unlit bodies don't disappear.
const BASE_COLOR = new Color(0x28282e);
// Matches the 2D canvas selection color (--primary yellow, #fbbf24).
const SELECTED_COLOR = new Color(0xfbbf24);

const RADIAL_SEGMENTS = 6;
const MAX_TUBULAR_SEGMENTS = 128;

interface PolylineRange {
  fixtureId: string | number;
  /** Range in the merged index buffer (element offsets, i.e. faceIndex·3). */
  indexStart: number;
  indexCount: number;
  /** Range in the merged vertex buffers. */
  vertexStart: number;
  vertexCount: number;
  /** Unselected color of this primitive. */
  color: Color;
}

/**
 * All `polyline` body primitives of kind fixtures (e.g. a strip's PCB) as
 * tubes merged into ONE mesh / one draw call. Gives unlit kind fixtures a
 * body, acts as a raycast target so clicking anywhere on the line selects
 * the fixture, and replays the 2D selection outline by tinting the owning
 * fixture's vertex-color range yellow. Per-primitive stroke colors are used
 * when given.
 *
 * Rebuilt only on layout changes (same cadence as FixtureBodies); has no
 * per-frame work — emitter colors live in PixelCloud.
 */
export class BodyPolylines {
  readonly mesh: Mesh;
  private material = new MeshBasicMaterial({ vertexColors: true });
  private ranges: PolylineRange[] = [];
  private selected = new Set<string | number>();

  constructor(private scene: Scene) {
    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** Maps a raycast face hit back to the owning fixture. */
  fixtureIdAtFace(faceIndex: number): string | number | undefined {
    const el = faceIndex * 3;
    for (const r of this.ranges) {
      if (el >= r.indexStart && el < r.indexStart + r.indexCount) return r.fixtureId;
    }
    return undefined;
  }

  rebuild(models: PolylineModel[]): void {
    const old = this.mesh.geometry;
    this.ranges = [];

    const parts: BufferGeometry[] = [];
    for (const m of models) {
      if (m.polyline.length < 2) continue;
      const curve = new CatmullRomCurve3(m.polyline, m.isClosed, 'catmullrom', 0.5);
      const tubularSegments = Math.min(MAX_TUBULAR_SEGMENTS, Math.max(8, m.polyline.length));
      const tube = new TubeGeometry(curve, tubularSegments, m.radius, RADIAL_SEGMENTS, m.isClosed);
      // Tube UVs/normals aren't needed for the unlit vertex-color material.
      tube.deleteAttribute('uv');
      tube.deleteAttribute('normal');
      this.ranges.push({
        fixtureId: m.fixtureId,
        color: m.color ? new Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255) : BASE_COLOR,
        indexStart: 0, // filled below once merged offsets are known
        indexCount: tube.index!.count,
        vertexStart: 0,
        vertexCount: tube.getAttribute('position').count,
      });
      parts.push(tube);
    }

    if (parts.length === 0) {
      this.mesh.geometry = new BufferGeometry();
      this.mesh.visible = false;
      old.dispose();
      return;
    }

    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();

    // Accumulate merged offsets (mergeGeometries concatenates in order).
    let idx = 0;
    let vtx = 0;
    for (const r of this.ranges) {
      r.indexStart = idx;
      r.vertexStart = vtx;
      idx += r.indexCount;
      vtx += r.vertexCount;
    }

    merged.setAttribute('color', new BufferAttribute(new Float32Array(vtx * 3), 3));
    this.mesh.geometry = merged;
    this.mesh.visible = true;
    old.dispose();
    this.applyColors();
  }

  setSelection(selected: Set<string | number>): void {
    this.selected = selected;
    if (this.ranges.length > 0) this.applyColors();
  }

  private applyColors(): void {
    const attr = this.mesh.geometry.getAttribute('color') as BufferAttribute | undefined;
    if (!attr) return;
    const out = attr.array as Float32Array;
    for (const r of this.ranges) {
      const c = this.selected.has(r.fixtureId) ? SELECTED_COLOR : r.color;
      for (let v = r.vertexStart; v < r.vertexStart + r.vertexCount; v++) {
        out[v * 3] = c.r;
        out[v * 3 + 1] = c.g;
        out[v * 3 + 2] = c.b;
      }
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
