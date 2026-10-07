/**
 * Reads NeoPixel strips by kind id (ADR D16: connector → kind). Only the
 * fields the ESP nodes need; a structural view so this extension does not
 * import the `neopixel-strip` extension.
 */

/** `fixture.kind.id` of NeoPixel strips. */
export const NEOPIXEL_KIND_ID = 'neopixel-strip';

/** Strip parameters used by the ESP strip node. */
export interface StripView {
  shapeType: 'bezier' | 'line' | 'circle';
  chipType: string;
  ledCount: number;
  ledsPerMeter: number;
  groupSize: number;
  clockwise: boolean;
}

/** Strip parameters of a fixture view, or null for non-strip fixtures. */
export function stripOf(f: { readonly kind?: { readonly id: string; readonly config: unknown } } | null | undefined): StripView | null {
  if (!f?.kind || f.kind.id !== NEOPIXEL_KIND_ID) return null;
  const c = f.kind.config as Partial<StripView>;
  return {
    shapeType: c.shapeType ?? 'bezier',
    chipType: c.chipType ?? 'WS2812B',
    ledCount: c.ledCount ?? 0,
    ledsPerMeter: c.ledsPerMeter ?? 60,
    groupSize: c.groupSize ?? 1,
    clockwise: c.clockwise !== false,
  };
}

/** ceil(ledCount / groupSize), at least 1. */
export function stripPixelCount(s: Pick<StripView, 'ledCount' | 'groupSize'>): number {
  return Math.max(1, Math.ceil(s.ledCount / Math.max(1, Math.floor(s.groupSize))));
}
