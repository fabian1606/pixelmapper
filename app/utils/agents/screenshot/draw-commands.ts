/**
 * Backend-neutral draw commands of the `screenshot` layout view (WP-K).
 *
 * The scene builder emits these in image pixels with rounded numbers, so
 * the list is deterministic and snapshot-testable in Node; a thin canvas
 * backend (`canvas-backend.ts`) replays them on an OffscreenCanvas.
 */

// ── Commands ────────────────────────────────────

/** Fill / stroke style shared by the shape commands. */
export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  /** Line dash pattern in px. */
  dash?: number[];
}

/** One draw command (coordinates in image pixels). */
export type DrawCommand =
  | ({ op: 'rect'; x: number; y: number; w: number; h: number } & ShapeStyle)
  | ({ op: 'poly'; points: number[]; closed: boolean } & ShapeStyle)
  | ({ op: 'circle'; x: number; y: number; r: number } & ShapeStyle)
  /** Restricts later commands to a rectangle until `unclip`. */
  | { op: 'clip'; x: number; y: number; w: number; h: number }
  | { op: 'unclip' }
  | {
    op: 'text';
    x: number;
    y: number;
    text: string;
    size: number;
    color: string;
    align: 'left' | 'center' | 'right';
    baseline: 'top' | 'middle' | 'bottom';
    bold?: boolean;
    /** Outline color drawn behind the glyphs for legibility. */
    halo?: string;
  };

/** A finished scene. */
export interface DrawScene {
  width: number;
  height: number;
  background: string;
  commands: DrawCommand[];
}

// ── Helpers ─────────────────────────────────────

/** Rounds to 2 decimals (keeps snapshots stable across platforms). */
export function px(v: number): number {
  return Math.round(v * 100) / 100 + 0;
}

/** `rgb(r, g, b)` of a color tuple. */
export function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Relative luminance 0–255 (Rec. 601 weights, enough for contrast picks). */
export function luma(c: readonly [number, number, number]): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}
