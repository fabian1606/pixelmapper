import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Scene,
} from 'three';
import type { GuideLine, SpacingGap } from '~/utils/engine/alignment-guides';

/** Guide/spacing data handed over per drag frame — plain arrays in world meters. */
export interface AlignmentGuideData {
  guides: GuideLine[];
  spacing: SpacingGap[];
  /** Dragged selection center after snapping, [x, y, z] world meters. */
  draggedCenter: number[];
}

const MAX_SEGMENTS = 128;

/** Per-axis guide colors, echoing the translate gizmo's axis handles at lower saturation. */
const AXIS_COLORS = [new Color('#d9706f'), new Color('#6fbf73'), new Color('#6f95c9')];
const SPACING_COLOR = new Color('#c2578f');

/**
 * Renders live alignment guides in the 3D scene: one line from the dragged
 * pivot to every candidate center it aligns with (colored by the matched
 * axis), plus dashed-look spacing segments between equally spaced members.
 * One preallocated LineSegments, written per drag frame, hidden when empty.
 */
export class AlignmentGuides3D {
  private geometry = new BufferGeometry();
  private positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private colors = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private lines: LineSegments;

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
  }

  update(data: AlignmentGuideData | null): void {
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

    for (const guide of data.guides) {
      const color = AXIS_COLORS[guide.axis] ?? SPACING_COLOR;
      // draggedPoint, not draggedCenter: for an edge match the line runs along
      // the group's outermost row, which the dragged center doesn't lie on.
      for (const center of guide.matchedCenters) writeSegment(guide.draggedPoint, center, color);
    }
    for (const gap of data.spacing) {
      writeSegment(gap.from, gap.to, SPACING_COLOR);
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.setDrawRange(0, seg * 2);
    this.lines.visible = seg > 0;
  }

  clear(): void {
    this.geometry.setDrawRange(0, 0);
    this.lines.visible = false;
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
  }
}
