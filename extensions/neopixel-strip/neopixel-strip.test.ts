/**
 * `neopixel-strip` kind (plan P5.4): channels/beams/emitters from the
 * config, handles and their pure reducers, and integration with the core
 * (layout encoder positions, config command, persistence).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Json } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { createKindFixture, getKind, kindContext, rebuildKindFixture } from '~/utils/kinds/kind-host';
import { buildLayoutBin } from '~/utils/connectors/binary-encoder';
import { serializeFixture, deserializeFixture } from '~/utils/engine/serialize';
import extension from './extension';
import { buildStrip, deleteHandle, moveHandle } from './kind';

const ctx = kindContext('s');

beforeEach(() => {
  resetRegistry();
  registerExtension(extension);
});

describe('neopixel-strip build', () => {
  it('compiles channels, pixel beams with LED emitters and a capped polyline', () => {
    // 10 LEDs at 10/m = 1 m = 250 px; groups of 2 → 5 pixels; RGBW → 20 channels.
    const r = buildStrip({ shapeType: 'line', chipType: 'SK6812-RGBW', ledCount: 10, ledsPerMeter: 10, groupSize: 2, clockwise: true, points: [] }, ctx);
    expect(r.channels).toHaveLength(20);
    expect(r.channels.slice(0, 4).map(c => c.type)).toEqual(['RED', 'GREEN', 'BLUE', 'WHITE']);
    expect(r.beams).toHaveLength(5);
    expect(r.beams[0]!.emitters).toHaveLength(2);
    // Default line: centered on the origin, 250 px long; LEDs inset 2.5 %.
    const first = r.beams[0]!.emitters![0]!;
    expect(first.x).toBeCloseTo(-125 + 0.025 * 250);
    const body = r.body[0]!;
    expect(body.type).toBe('polyline');
    expect(r.handles.map(h => [h.id, h.role])).toEqual([['v:0', 'anchor'], ['v:1', 'anchor']]);
    expect(r.bounds.w).toBeCloseTo(250);
  });

  it('bezier strips expose vertices and segment midpoints', () => {
    const r = buildStrip({ shapeType: 'bezier', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }] } as Json, ctx);
    expect(r.handles.map(h => h.role)).toEqual(['anchor', 'vertex', 'vertex', 'midpoint', 'midpoint']);
    expect(r.handles[3]!.pos.x).toBeCloseTo(50, 0);
  });

  it('circles wrap LEDs around without handles', () => {
    const r = buildStrip({ shapeType: 'circle', ledCount: 4, ledsPerMeter: 4, groupSize: 1, points: [] } as Json, ctx);
    expect(r.handles).toEqual([]);
    expect((r.body[0] as { closed?: boolean }).closed).toBe(true);
    expect(r.beams).toHaveLength(4);
  });
});

describe('neopixel-strip handles', () => {
  const bezier = { shapeType: 'bezier', ledCount: 60, ledsPerMeter: 60, groupSize: 1, chipType: 'WS2812B', clockwise: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } as Json;

  it('moves vertices and inserts at midpoints (pure from the start config)', () => {
    const moved = moveHandle(bezier, 'v:1', { x: 120, y: 30 }, ctx) as { points: { x: number; y: number }[] };
    expect(moved.points[1]).toEqual({ x: 120, y: 30 });
    const inserted = moveHandle(bezier, 'm:0', { x: 50, y: 40 }, ctx) as { points: unknown[] };
    expect(inserted.points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }]);
    expect((bezier as { points: unknown[] }).points).toHaveLength(2);
  });

  it('lines keep their length when an endpoint is dragged', () => {
    const line = { shapeType: 'line', ledCount: 10, ledsPerMeter: 10, points: [{ x: 0, y: 0 }, { x: 250, y: 0 }] } as Json;
    const r = moveHandle(line, 'v:1', { x: 0, y: 500 }, ctx) as { points: { x: number; y: number }[] };
    expect(r.points[1]!.x).toBeCloseTo(0);
    expect(r.points[1]!.y).toBeCloseTo(250);
  });

  it('deletes inner vertices but never the anchor or below two vertices', () => {
    const three = moveHandle(bezier, 'm:0', { x: 50, y: 40 }, ctx);
    expect((deleteHandle(three, 'v:1', ctx) as { points: unknown[] }).points).toHaveLength(2);
    expect((deleteHandle(three, 'v:0', ctx) as { points: unknown[] }).points).toHaveLength(3);
    expect((deleteHandle(bezier, 'v:1', ctx) as { points: unknown[] }).points).toHaveLength(2);
  });
});

describe('neopixel-strip in the core', () => {
  it('places channels at their pixel centers in the layout packet', () => {
    const def = getKind('neopixel-strip')!.def;
    const f = createKindFixture(def, { id: 's', config: { shapeType: 'line', ledCount: 2, ledsPerMeter: 2, groupSize: 1, chipType: 'WS2812B', clockwise: true, points: [] } as Json, position: { x: 0.5, y: 0.5 } });
    const packet = buildLayoutBin([f]);
    const view = new DataView(packet.buffer, packet.byteOffset + 5);
    // header (v3): f32 metersPerUnit, u16 count; fixture: u16 group, u32 hash, u16 channels; channel (24 B): u16 dmx, u8 type, f32 x …
    const x0 = view.getFloat32(6 + 8 + 3, true);
    const x1 = view.getFloat32(6 + 8 + 3 * 24 + 3, true);
    // 1 m strip = 250 px, LEDs at 2.5 % and 97.5 % → ±118.75 px around 1500.
    expect(x0 * 3000).toBeCloseTo(1500 - 118.75, 1);
    expect(x1 * 3000).toBeCloseTo(1500 + 118.75, 1);
  });

  it('round-trips through persistence and rebuilds identically', () => {
    const f = createKindFixture(getKind('neopixel-strip')!.def, { id: 's' });
    f.kind!.config = moveHandle(f.kind!.config as Json, 'm:0', { x: 10, y: 60 }, ctx);
    rebuildKindFixture(f);
    const back = deserializeFixture(JSON.parse(JSON.stringify(serializeFixture(f))));
    expect(back.kind!.compiled!.handles.length).toBe(f.kind!.compiled!.handles.length);
    expect(back.channels.length).toBe(180);
  });
});
