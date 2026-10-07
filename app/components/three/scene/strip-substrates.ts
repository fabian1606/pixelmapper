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
import type { StripModel } from './fixture-adapter';

// Matches the 2D substrate stroke rgba(40,40,40) — visible against the
// near-black floor so unlit strips don't disappear.
const BASE_COLOR = new Color(0x28282e);
// Matches the 2D canvas selection color (--primary yellow, #fbbf24).
const SELECTED_COLOR = new Color(0xfbbf24);

const RADIAL_SEGMENTS = 6;
const MAX_TUBULAR_SEGMENTS = 128;

interface StripRange {
  fixtureId: string | number;
  /** Range in the merged index buffer (element offsets, i.e. faceIndex·3). */
  indexStart: number;
  indexCount: number;
  /** Range in the merged vertex buffers. */
  vertexStart: number;
  vertexCount: number;
}

/**
 * All NeoPixel strip substrates (the visible PCB/tube of each strip) merged
 * into ONE mesh / one draw call. Gives unlit strips a body, acts as a raycast
 * target so clicking anywhere on the curve selects the strip, and replays the
 * 2D selection outline by tinting the strip's vertex-color range yellow.
 *
 * Rebuilt only on layout changes (same cadence as FixtureBodies); has no
 * per-frame work — LED colors live in PixelCloud.
 */
export class StripSubstrates {
  readonly mesh: Mesh;
  private material = new MeshBasicMaterial({ vertexColors: true });
  private ranges: StripRange[] = [];
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

  rebuild(models: StripModel[]): void {
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
      const c = this.selected.has(r.fixtureId) ? SELECTED_COLOR : BASE_COLOR;
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
