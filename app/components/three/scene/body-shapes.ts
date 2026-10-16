import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShapeUtils,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShapeModel } from './fixture-adapter';

// Default fill of flat body shapes and the selection tint (2D: --primary).
const BASE_COLOR = new Color(0x28282e);
const SELECTED_COLOR = new Color(0xfbbf24);

/** Vertex range of one shape in the merged buffers. */
interface ShapeRange {
  fixtureId: string | number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  color: Color;
}

/**
 * Flat `circle` / `rect` / `polygon` body primitives of kind fixtures as
 * filled shapes lying in the fixture's (tilted) plane, merged into one mesh.
 * Shapes arrive as world-space outlines (`ShapeModel.outline`, meters); the
 * mesh is a raycast target and tints the owner on selection, like
 * `BodyPolylines`.
 */
export class BodyShapes {
  readonly mesh: Mesh;
  private material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.9 });
  private ranges: ShapeRange[] = [];
  private selected = new Set<string | number>();

  constructor(private scene: Scene) {
    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** Maps a raycast face hit back to the owning fixture. */
  fixtureIdAtFace(faceIndex: number): string | number | undefined {
    const el = faceIndex * 3;
    return this.ranges.find(r => el >= r.indexStart && el < r.indexStart + r.indexCount)?.fixtureId;
  }

  rebuild(models: ShapeModel[]): void {
    const old = this.mesh.geometry;
    this.ranges = [];
    const parts: BufferGeometry[] = [];
    for (const m of models) {
      if (m.outline.length < 3) continue;
      // Triangulate the flat (kind-relative) outline; indices refer to the
      // outline points, whose 3D positions become the vertices.
      const faces = ShapeUtils.triangulateShape(m.flat.map(p => new Vector2(p.x, p.y)), []);
      if (faces.length === 0) continue;
      const geo = new BufferGeometry();
      const pos = new BufferAttribute(new Float32Array(m.outline.length * 3), 3);
      m.outline.forEach((v, i) => pos.setXYZ(i, v.x, v.y, v.z));
      geo.setAttribute('position', pos);
      geo.setIndex(faces.flat());
      this.ranges.push({
        fixtureId: m.fixtureId,
        vertexStart: 0,
        vertexCount: pos.count,
        indexStart: 0,
        indexCount: geo.index!.count,
        color: m.color ? new Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255) : BASE_COLOR,
      });
      parts.push(geo);
    }
    if (parts.length === 0) {
      this.mesh.geometry = new BufferGeometry();
      this.mesh.visible = false;
      old.dispose();
      return;
    }
    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
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

  /** Writes base/selected colors into the vertex-color buffer. */
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
