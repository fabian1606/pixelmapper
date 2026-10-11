/**
 * Tests for the TS modifier model (plan P3.11): instance creation from
 * manifests, cloning, naming and the TYPE_MODIFIERS_BIN encoder.
 */
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { BUILTIN_ALIASES, builtinHash, cloneModifier, createModifier, modifierName } from './modifiers';
import { buildModifiersBin, TYPE_MODIFIERS_BIN } from '~/utils/connectors/binary-encoder';
import { getManifest } from '~/utils/plugins/plugin-store';
import { Fixture } from '~/utils/engine/core/fixture';

/** Decodes the distribution blocks of a v2 modifiers packet (test helper, mirrors bin_protocol.rs). */
function decode(packet: Uint8Array) {
  const v = new DataView(packet.buffer, packet.byteOffset + 5);
  let o = 0;
  const u8 = () => v.getUint8(o++);
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  const u32 = () => { const x = v.getUint32(o, true); o += 4; return x; };
  const f32 = () => { const x = v.getFloat32(o, true); o += 4; return x; };
  const version = u8();
  const count = u16();
  const out = [];
  for (let i = 0; i < count; i++) {
    u32(); u16(); u8(); u8(); u8(); f32(); // key, plugin, signature, output, blend, strength
    u8(); f32(); f32(); f32(); // speed
    const dist = {
      scope: u8(), mode: u8(), origin: [f32(), f32()], end: [f32(), f32()], reverse: u8(),
      grouping: u8(), n: u8(), seed: u32(), withinOffset: u8(), ranks: [] as [number, number][],
    };
    const entries = u16();
    for (let e = 0; e < entries; e++) dist.ranks.push([u16(), u16()]);
    const nTypes = u8();
    o += nTypes;
    const maskBytes = u16();
    o += maskBytes;
    const nParams = u16();
    const params = Array.from({ length: nParams }, f32);
    out.push({ dist, params });
  }
  return { version, instances: out, size: packet.length };
}

/** `n` fixtures in a row (one beam each). */
function rowOf(n: number): Fixture[] {
  return Array.from({ length: n }, (_, i) => {
    const f = new Fixture(`f${i}`, [], 1 + i);
    f.fixturePosition = { x: (i + 0.5) / n, y: 0.5 };
    return f;
  });
}

describe('modifier instances', () => {
  it('creates instances with manifest param defaults', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.sequencer), { targetChannels: ['DIMMER'] });
    expect(m.signature).toBe('scalar');
    expect(m.params.steps).toEqual({ groups: 2, steps: 2, cells: [[true, false], [false, true]] });
    // Manifest distribution default (plan §1.4).
    expect(m.distribution.mode).toBe('order');
    expect(m.targetChannels).toEqual(['DIMMER']);
  });

  it('rejects unknown plugins', () => {
    expect(() => createModifier('sha256:00')).toThrow();
  });

  it('clones deeply (also reactive proxies)', () => {
    const m = reactive(createModifier(builtinHash(BUILTIN_ALIASES.sequencer)));
    const c = cloneModifier(m);
    (c.params.steps as { cells: boolean[][] }).cells[0]![0] = false;
    expect((m.params.steps as { cells: boolean[][] }).cells[0]![0]).toBe(true);
  });

  it('names instances by manifest name and first enum label', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.colorAdjust), { params: { mode: 'palette' } });
    expect(modifierName(m)).toBe('Color Shift · Palette');
  });
});

describe('buildModifiersBin', () => {
  it('encodes known plugins and builds the plugin table', () => {
    const wave = builtinHash(BUILTIN_ALIASES.waveform);
    const mods = [
      createModifier(wave, { targetChannels: ['DIMMER'] }),
      createModifier(wave, { targetChannels: ['RED'] }),
    ];
    const { packet, plugins } = buildModifiersBin(mods, [], getManifest);
    expect(plugins).toEqual([wave]);
    expect(packet[0]).toBe(0xaa);
    expect(packet[1]).toBe(0x55);
    expect(packet[2]).toBe(TYPE_MODIFIERS_BIN);
    // Payload: version 2, count 2.
    expect(packet[5]).toBe(2);
    expect(packet[6]! | (packet[7]! << 8)).toBe(2);
  });

  it('skips instances whose manifest is unknown', () => {
    const m = { ...createModifier(builtinHash(BUILTIN_ALIASES.waveform)), plugin: 'sha256:missing' };
    const { packet, plugins } = buildModifiersBin([m], [], getManifest);
    expect(plugins).toEqual([]);
    expect(packet[6]).toBe(0);
  });
});

describe('buildModifiersBin v2 distribution (M3.4)', () => {
  it('round-trips the distribution block and the rank table', () => {
    const fixtures = rowOf(4);
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'],
      targetFixtureIds: ['f0', 'f1', 'f3'],
      distribution: {
        mode: 'order', reverse: true, grouping: { kind: 'sections', n: 3, seed: 9 },
        order: { ranks: {}, line: { a: { x: 1, y: 0.5 }, b: { x: 0, y: 0.5 } }, snap: 0.5 },
      },
    });
    const { version, instances } = decode(buildModifiersBin([m], fixtures, getManifest).packet);
    expect(version).toBe(2);
    const d = instances[0]!.dist;
    expect(d).toMatchObject({ scope: 0, mode: 4, reverse: 1, grouping: 2, n: 3, seed: 9, withinOffset: 0 });
    // Line right → left over the targeted fixtures: f3 first, then f1, f0.
    expect(Object.fromEntries(d.ranks)).toEqual({ 3: 0, 1: 1, 0: 2 });
  });

  it('sends no ranks for gradient modes and writes origin/end', () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      distribution: { mode: 'radial', origin: { x: 0.25, y: 0.5 }, end: { x: 0.5, y: 0.75 } },
    });
    const d = decode(buildModifiersBin([m], rowOf(3), getManifest).packet).instances[0]!.dist;
    expect(d.mode).toBe(2);
    expect(d.origin).toEqual([0.25, 0.5]);
    expect(d.end).toEqual([0.5, 0.75]);
    expect(d.ranks).toEqual([]);
  });

  it('stays far below the 64 KB frame budget for 200 fixtures', () => {
    const fixtures = rowOf(200);
    const mods = Array.from({ length: 8 }, () => createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'], targetFixtureIds: fixtures.map(f => f.id), distribution: { mode: 'order' },
    }));
    const { size, instances } = decode(buildModifiersBin(mods, fixtures, getManifest).packet);
    expect(instances[0]!.dist.ranks.length).toBe(200);
    // 8 ordered instances × (200 rank entries + mask + params) — documented budget: < 64 KB.
    expect(size).toBeLessThan(16_000);
  });
});
