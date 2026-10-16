// @vitest-environment node
/**
 * ArtDMX encoding shared by the direct-UDP path and the bridge (ADR 0003 D5).
 */
import { describe, expect, it } from 'vitest';
import { ArtDmxSequencer, encodeArtDmx, toArtNetUniverse } from './art-dmx';

describe('encodeArtDmx', () => {
  it('writes header, opcode, version, sequence and length', () => {
    const p = encodeArtDmx(0, new Uint8Array([1, 2, 3]), 7);
    expect(p.length).toBe(18 + 512);
    expect(new TextDecoder().decode(p.subarray(0, 7))).toBe('Art-Net');
    expect([p[7], p[8], p[9], p[10], p[11], p[12]]).toEqual([0, 0x00, 0x50, 0, 14, 7]);
    expect([p[16], p[17]]).toEqual([0x02, 0x00]);
  });

  it('splits the port-address into sub-uni and net', () => {
    const p = encodeArtDmx(0x1234, new Uint8Array(0), 1);
    expect(p[14]).toBe(0x34);
    expect(p[15]).toBe(0x12);
  });

  it('zero-pads short and cuts long payloads', () => {
    expect([...encodeArtDmx(0, new Uint8Array([9, 8]), 1).subarray(18, 21)]).toEqual([9, 8, 0]);
    const long = new Uint8Array(600).fill(5);
    expect(encodeArtDmx(0, long, 1).length).toBe(530);
  });
});

describe('toArtNetUniverse', () => {
  it('maps 1-based app universes to 0-based port-addresses', () => {
    expect(toArtNetUniverse(1)).toBe(0);
    expect(toArtNetUniverse(4)).toBe(3);
    expect(toArtNetUniverse(0)).toBeNull();
    expect(toArtNetUniverse(1.5)).toBeNull();
  });
});

describe('ArtDmxSequencer', () => {
  it('counts per universe and wraps 255 → 1', () => {
    const s = new ArtDmxSequencer();
    expect(s.next(0)).toBe(1);
    expect(s.next(1)).toBe(1);
    for (let i = 2; i <= 255; i++) s.next(0);
    expect(s.next(0)).toBe(1);
  });
});
