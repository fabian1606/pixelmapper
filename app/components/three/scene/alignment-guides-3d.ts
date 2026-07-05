import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Scene,
} from 'three';
import { pinSpacingGap, type GuideLine, type SpacingGap } from '~/utils/engine/alignment-guides';

/** Guide/spacing data handed over per drag frame — plain arrays in world meters. */
export interface AlignmentGuideData {
  guides: GuideLine[];
  spacing: SpacingGap[];
  /** Dragged selection center after snapping, [x, y, z] world meters. */
  draggedCenter: number[];
  /**
   * Which world axes the gizmo is actively dragging — [x, y, z]. A fixture
   * matched on several axes at once gets its dot colored by the axis the user
   * is moving (the alignment they're hunting for), not by a stale off-axis
   * match it already sat on. Defaults to all-active when absent.
   */
  activeAxes?: boolean[];
}

const MAX_SEGMENTS = 512;
const MAX_DOTS = 128;
/** Guide lines extend this many screen px past the outermost matched point. */
const EXTEND_PX = 8;
/** Dash/gap sizes for edge guides, in screen px (LineDashedMaterial can't mix with vertex colors, so dashes are emulated as segments). */
const DASH_PX = 5;
const DASH_GAP_PX = 4;
/** Backstop so one long dashed line can't exhaust the segment buffer. */
const MAX_DASHES_PER_LINE = 120;

/** Per-axis guide colors, echoing the translate gizmo's axis handles at lower saturation. */
const AXIS_COLORS = [new Color('#d9706f'), new Color('#6fbf73'), new Color('#6f95c9')];
const SPACING_COLOR = new Color('#c2578f');

function makeDotTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return new CanvasTexture(canvas);
}

/**
 * Renders live alignment guides in the 3D scene, Figma-style: one axis-parallel
 * line per guide (never diagonal — the line runs along the row's long axis at
 * the matched value, dash-emulated for group-edge matches), equal-spacing
 * segments pinned exactly onto that line, and a screen-sized dot over every
 * fixture involved in the match. Preallocated LineSegments + Points, written
 * per drag frame, hidden when empty.
 */
export class AlignmentGuides3D {
  private geometry = new BufferGeometry();
  private positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private colors = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private lines: LineSegments;

  private dotGeometry = new BufferGeometry();
  private dotPositions = new Float32Array(MAX_DOTS * 3);
  private dotColors = new Float32Array(MAX_DOTS * 3);
  private dots: Points;
  private dotTexture: CanvasTexture | null;

  constructor(scene: Scene) {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    this.lines = new LineSegments(this.geometry, material);
    this.lines.renderOrder = 999;
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);

    this.dotGeometry.setAttribute('position', new BufferAttribute(this.dotPositions, 3));
    this.dotGeometry.setAttribute('color', new BufferAttribute(this.dotColors, 3));
    this.dotGeometry.setDrawRange(0, 0);
    this.dotTexture = makeDotTexture();
    const dotMaterial = new PointsMaterial({
      size: 8,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
      transparent: true,
      map: this.dotTexture ?? undefined,
      alphaTest: this.dotTexture ? 0.5 : 0,
    });
    this.dots = new Points(this.dotGeometry, dotMaterial);
    this.dots.renderOrder = 1000;
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    scene.add(this.dots);
  }

  /**
   * @param worldPerPixel meters per screen pixel at the drag pivot — sizes
   * line extension and dash lengths so they stay screen-constant.
   */
  update(data: AlignmentGuideData | null, worldPerPixel: number): void {
    if (!data || (data.guides.length === 0 && data.spacing.length === 0)) {
      this.clear();
      return;
    }
    let seg = 0;
    const writeSegment = (from: number[], to: number[], color: Color): void => {
      if (seg >= MAX_SEGMENTS) return;
      const p = seg * 6;
      this.positions[p] = from[0]!; this.positions[p + 1] = from[1]!; this.positions[p + 2] = from[2]!;
      this.positions[p + 3] = to[0]!; this.positions[p + 4] = to[1]!; this.positions[p + 5] = to[2]!;
      for (const off of [0, 3]) {
        this.colors[p + off] = color.r;
        this.colors[p + off + 1] = color.g;
        this.colors[p + off + 2] = color.b;
      }
      seg++;
    };
    /** Axis-parallel line from `min` to `max` along `axis`, chopped into dashes. */
    const writeDashed = (base: number[], axis: number, min: number, max: number, color: Color): void => {
      const length = max - min;
      let dash = DASH_PX * worldPerPixel;
      let gap = DASH_GAP_PX * worldPerPixel;
      const count = Math.ceil(length / (dash + gap));
      if (count > MAX_DASHES_PER_LINE) {
        const scale = count / MAX_DASHES_PER_LINE;
        dash *= scale;
        gap *= scale;
      }
      const from = base.slice();
      const to = base.slice();
      for (let start = min; start < max; start += dash + gap) {
        from[axis] = start;
        to[axis] = Math.min(start + dash, max);
        writeSegment(from, to, color);
      }
    };

    const extend = EXTEND_PX * worldPerPixel;
    const eps = EXTEND_PX * worldPerPixel;
    const dotEps = extend * 0.5; // world tolerance for "same fixture" dedup

    // A fixture can sit on several guide lines at once (e.g. an old X-alignment
    // it already had, plus the new Z-alignment the user is now dragging into).
    // Its dot must show the axis being *moved* — that's the alignment the user
    // is looking for — so higher-priority (active-axis) writes overwrite the
    // color of an existing dot at the same spot instead of stacking on top.
    let dot = 0;
    const dotPriority = new Int8Array(MAX_DOTS);
    const findDot = (p: number[]): number => {
      for (let i = 0; i < dot; i++) {
        const j = i * 3;
        if (
          Math.abs(this.dotPositions[j]! - p[0]!) <= dotEps &&
          Math.abs(this.dotPositions[j + 1]! - p[1]!) <= dotEps &&
          Math.abs(this.dotPositions[j + 2]! - p[2]!) <= dotEps
        ) return i;
      }
      return -1;
    };
    const paintDot = (i: number, color: Color): void => {
      const j = i * 3;
      this.dotColors[j] = color.r;
      this.dotColors[j + 1] = color.g;
      this.dotColors[j + 2] = color.b;
    };
    const writeDot = (p: number[], color: Color, priority: number): void => {
      const existing = findDot(p);
      if (existing >= 0) {
        if (priority > dotPriority[existing]!) {
          paintDot(existing, color);
          dotPriority[existing] = priority;
        }
        return;
      }
      if (dot >= MAX_DOTS) return;
      const i = dot * 3;
      this.dotPositions[i] = p[0]!;
      this.dotPositions[i + 1] = p[1]!;
      this.dotPositions[i + 2] = p[2]!;
      paintDot(dot, color);
      dotPriority[dot] = priority;
      dot++;
    };

    const activeAxes = data.activeAxes ?? [true, true, true];

    for (const guide of data.guides) {
      const color = AXIS_COLORS[guide.axis] ?? SPACING_COLOR;
      const points = [...guide.matchedCenters, guide.draggedPoint];

      // The line runs along the cross axis the matched row actually spreads
      // on; the remaining cross axis is pinned to the dragged point. Matched
      // fixtures off that line are still marked by their dot — the line
      // itself never leaves its axis.
      const crossAxes: number[] = [];
      for (let a = 0; a < guide.draggedPoint.length; a++) {
        if (a !== guide.axis) crossAxes.push(a);
      }
      let longAxis = crossAxes[0]!;
      let bestSpread = -1;
      for (const a of crossAxes) {
        let min = Infinity;
        let max = -Infinity;
        for (const p of points) {
          if (p[a]! < min) min = p[a]!;
          if (p[a]! > max) max = p[a]!;
        }
        if (max - min > bestSpread) {
          bestSpread = max - min;
          longAxis = a;
        }
      }
      let min = Infinity;
      let max = -Infinity;
      for (const p of points) {
        if (p[longAxis]! < min) min = p[longAxis]!;
        if (p[longAxis]! > max) max = p[longAxis]!;
      }

      const base = guide.draggedPoint.slice();
      base[guide.axis] = guide.value;
      if (guide.dashed) {
        writeDashed(base, longAxis, min - extend, max + extend, color);
      } else {
        const from = base.slice();
        from[longAxis] = min - extend;
        const to = base.slice();
        to[longAxis] = max + extend;
        writeSegment(from, to, color);
      }

      // Highlight every fixture involved in the match at its true position.
      // Active-axis matches win the dot color where lines overlap.
      const priority = activeAxes[guide.axis] ? 1 : 0;
      const markPoints = guide.marks.length > 0 ? guide.marks : guide.matchedCenters;
      for (const mark of markPoints) writeDot(mark, color, priority);
    }

    for (const gap of data.spacing) {
      const { from, to } = pinSpacingGap(gap, data.guides, eps);
      writeSegment(from, to, SPACING_COLOR);
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.setDrawRange(0, seg * 2);
    this.lines.visible = seg > 0;

    this.dotGeometry.getAttribute('position').needsUpdate = true;
    this.dotGeometry.getAttribute('color').needsUpdate = true;
    this.dotGeometry.setDrawRange(0, dot);
    this.dots.visible = dot > 0;
  }

  clear(): void {
    this.geometry.setDrawRange(0, 0);
    this.lines.visible = false;
    this.dotGeometry.setDrawRange(0, 0);
    this.dots.visible = false;
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
    this.dots.removeFromParent();
    this.dotGeometry.dispose();
    (this.dots.material as PointsMaterial).dispose();
    this.dotTexture?.dispose();
  }
}
