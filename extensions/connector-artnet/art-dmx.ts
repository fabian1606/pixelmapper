/**
 * ArtDMX packet encoding, shared by the direct-UDP path of the connector
 * (desktop app, ADR 0003) and the WebSocket→UDP bridge in
 * `tools/artnet-bridge`, so there is exactly one encoder.
 */

/** Default ArtNet UDP port. */
export const ARTNET_PORT = 6454;

/** DMX payload length (always a full universe). */
const DMX_LENGTH = 512;

/** "Art-Net\0" packet id. */
const ART_NET_HEADER = new Uint8Array([0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]);

/**
 * Builds one ArtDMX packet.
 *
 * @param universe 0-based ArtNet port-address (net + sub-net + universe, 15 bit)
 * @param dmx channel values; shorter buffers are zero-padded, longer ones cut
 * @param sequence 1..255 (0 disables sequencing on the receiver)
 */
export function encodeArtDmx(universe: number, dmx: Uint8Array, sequence: number): Uint8Array {
  const out = new Uint8Array(18 + DMX_LENGTH);
  out.set(ART_NET_HEADER, 0);
  out[8] = 0x00; // OpCode ArtDMX = 0x5000, little-endian
  out[9] = 0x50;
  out[10] = 0x00; // ProtVer 14, big-endian
  out[11] = 14;
  out[12] = sequence & 0xff;
  out[13] = 0x00; // physical
  out[14] = universe & 0xff; // sub-net + universe
  out[15] = (universe >> 8) & 0x7f; // net
  out[16] = (DMX_LENGTH >> 8) & 0xff;
  out[17] = DMX_LENGTH & 0xff;
  out.set(dmx.subarray(0, Math.min(dmx.length, DMX_LENGTH)), 18);
  return out;
}

/**
 * Converts the app's 1-based universe numbers (U1, U2, … as in QLC+) to the
 * 0-based ArtNet port-address. Returns `null` for invalid numbers.
 */
export function toArtNetUniverse(appUniverse: number): number | null {
  return Number.isInteger(appUniverse) && appUniverse >= 1 ? appUniverse - 1 : null;
}

/** Per-universe ArtDMX sequence counter (1..255, wraps to 1). */
export class ArtDmxSequencer {
  private seq = new Map<number, number>();

  /** Next sequence number for `universe`. */
  next(universe: number): number {
    const prev = this.seq.get(universe) ?? 0;
    const next = prev >= 255 ? 1 : prev + 1;
    this.seq.set(universe, next);
    return next;
  }

  /** Forgets all counters (new connection). */
  reset(): void {
    this.seq.clear();
  }
}
