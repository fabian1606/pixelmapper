import type { Fixture } from '~/utils/engine/core/fixture';

// ── Intensity (master + group dimmers) ────────────────────────────────────────
//
// Master and group dimmer faders don't touch channel values: they become
// per-channel factors the engine applies after chasers and modifiers
// (TYPE_INTENSITY_BIN 0x17). Presets, color variants and effects keep running
// underneath, nothing can reset the faders, and every output — DMX, 2D canvas
// preview, 3D — shows the dimmed level.
//
// Per fixture the factor scales what carries the intensity: DIMMER channels
// when the fixture has any, otherwise all COLOR channels by the same factor,
// which keeps the color ratio (RGB-only pixel bars dim without a hue shift).

/** One group dimmer: the fixtures it covers and its level (0..1). */
export interface GroupLevel {
  fixtureIds: readonly (string | number)[];
  level: number;
}

/** Buffer indexes (0-based, global) that carry a fixture's intensity. */
export function intensitySlots(fixture: Fixture): number[] {
  const hasDimmer = fixture.channels.some(ch => ch.role === 'DIMMER');
  const role = hasDimmer ? 'DIMMER' : 'COLOR';
  const base = fixture.startAddress - 1;
  return fixture.channels.filter(ch => ch.role === role).map(ch => base + ch.addressOffset);
}

/**
 * (buffer index, factor) for every slot below full: factor = master × the
 * levels of all group dimmers that cover the fixture (overlapping groups
 * multiply, like group masters on a console).
 */
export function buildIntensityEntries(
  fixtures: readonly Fixture[],
  master: number,
  groups: Iterable<GroupLevel>,
): [number, number][] {
  const perFixture = new Map<string | number, number>();
  for (const g of groups) {
    if (g.level >= 1) continue;
    for (const id of g.fixtureIds) perFixture.set(id, (perFixture.get(id) ?? 1) * Math.max(0, g.level));
  }
  const entries: [number, number][] = [];
  for (const fixture of fixtures) {
    const factor = Math.max(0, master) * (perFixture.get(fixture.id) ?? 1);
    if (factor >= 1) continue;
    for (const slot of intensitySlots(fixture)) entries.push([slot, factor]);
  }
  return entries;
}

/** Encodes the 0x17 payload: `u32 count; { u32 dmxIndex; f32 factor }`. */
export function encodeIntensity(entries: readonly [number, number][]): Uint8Array {
  const view = new DataView(new ArrayBuffer(4 + entries.length * 8));
  view.setUint32(0, entries.length, true);
  entries.forEach(([index, factor], i) => {
    view.setUint32(4 + i * 8, index, true);
    view.setFloat32(8 + i * 8, factor, true);
  });
  return new Uint8Array(view.buffer);
}
