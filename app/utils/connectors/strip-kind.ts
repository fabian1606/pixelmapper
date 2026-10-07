/**
 * ESP connector support: reading NeoPixel strips by kind id (ADR D16 —
 * dependency direction connector → kind). Moves into the ESP connector
 * extension with plan P6.2; the core has no strip semantics of its own.
 *
 * The connector only needs a structural view of the `neopixel-strip` kind
 * config, declared here so connector code does not import the extension.
 */
import type { Fixture } from '~/utils/engine/core/fixture';

/** `fixture.kind.id` of NeoPixel strips. */
export const NEOPIXEL_KIND_ID = 'neopixel-strip';

/** The parts of the strip kind config the ESP connectors use. */
export interface StripKindView {
  shapeType: 'bezier' | 'line' | 'circle';
  chipType: string;
  ledCount: number;
  ledsPerMeter: number;
  groupSize: number;
  clockwise: boolean;
}

/** Strip config of a fixture, or null for other fixtures. */
export function stripOf(f: Fixture | null | undefined): StripKindView | null {
  if (!f?.kind || f.kind.id !== NEOPIXEL_KIND_ID) return null;
  const c = f.kind.config as Partial<StripKindView>;
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
export function stripPixelCount(s: Pick<StripKindView, 'ledCount' | 'groupSize'>): number {
  return Math.max(1, Math.ceil(s.ledCount / Math.max(1, Math.floor(s.groupSize))));
}
