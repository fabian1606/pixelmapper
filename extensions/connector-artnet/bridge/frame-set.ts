/**
 * Binary DMX frame set of the bridge contract (§7): one WebSocket message
 * per rendered frame carrying every routed universe. This is the WebSocket
 * framing between app and bridge, not an Art-Net packet — the bridge builds
 * the ArtDmx/ArtSync packets from it.
 *
 * Layout: `"PM"` magic, kind 0x01, flags (bit 0 = ArtSync), count u16 LE,
 * then per entry route u16 LE, length u16 LE, `length` slot bytes.
 */

/** Magic bytes `"PM"`. */
export const FRAME_SET_MAGIC = [0x50, 0x4d] as const;

/** Message kind: DMX frame set (app → bridge). */
export const FRAME_KIND_DMX_SET = 0x01;

/** Flag bit: the bridge sends ArtSync after the set. */
export const FRAME_FLAG_SYNC = 0x01;

/** Header bytes before the first entry. */
export const FRAME_SET_HEADER_BYTES = 6;

/** Bytes before the slot data of every entry. */
export const FRAME_ENTRY_HEADER_BYTES = 4;

/** Largest DMX payload of one entry. */
export const MAX_DMX_LENGTH = 512;

/** One routed universe of a frame set. */
export interface FrameSetEntry {
  /** Route id from the connection's `dmxRoutes` table (1–65535). */
  route: number;
  /** Slot values, slot 1 first (cut to 512 bytes). */
  data: Uint8Array;
}

/** Encodes a frame set (entries with empty data are skipped). */
export function encodeFrameSet(entries: readonly FrameSetEntry[], sync = true): Uint8Array {
  const usable = entries.filter(e => e.data.length > 0 && e.route >= 1 && e.route <= 0xffff);
  let size = FRAME_SET_HEADER_BYTES;
  for (const e of usable) size += FRAME_ENTRY_HEADER_BYTES + Math.min(e.data.length, MAX_DMX_LENGTH);
  const out = new Uint8Array(size);
  out[0] = FRAME_SET_MAGIC[0];
  out[1] = FRAME_SET_MAGIC[1];
  out[2] = FRAME_KIND_DMX_SET;
  out[3] = sync ? FRAME_FLAG_SYNC : 0;
  out[4] = usable.length & 0xff;
  out[5] = (usable.length >> 8) & 0xff;
  let o = FRAME_SET_HEADER_BYTES;
  for (const e of usable) {
    const len = Math.min(e.data.length, MAX_DMX_LENGTH);
    out[o] = e.route & 0xff;
    out[o + 1] = (e.route >> 8) & 0xff;
    out[o + 2] = len & 0xff;
    out[o + 3] = (len >> 8) & 0xff;
    out.set(e.data.subarray(0, len), o + FRAME_ENTRY_HEADER_BYTES);
    o += FRAME_ENTRY_HEADER_BYTES + len;
  }
  return out;
}

/** A decoded frame set (used by tests and fake bridges). */
export interface DecodedFrameSet {
  sync: boolean;
  entries: { route: number; data: Uint8Array }[];
}

/** Decodes a frame set; null when the message is not a valid one. */
export function decodeFrameSet(msg: Uint8Array): DecodedFrameSet | null {
  if (msg.length < FRAME_SET_HEADER_BYTES) return null;
  if (msg[0] !== FRAME_SET_MAGIC[0] || msg[1] !== FRAME_SET_MAGIC[1] || msg[2] !== FRAME_KIND_DMX_SET) return null;
  const count = msg[4]! | (msg[5]! << 8);
  const entries: DecodedFrameSet['entries'] = [];
  let o = FRAME_SET_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (o + FRAME_ENTRY_HEADER_BYTES > msg.length) return null;
    const route = msg[o]! | (msg[o + 1]! << 8);
    const len = msg[o + 2]! | (msg[o + 3]! << 8);
    o += FRAME_ENTRY_HEADER_BYTES;
    if (len < 1 || len > MAX_DMX_LENGTH || o + len > msg.length) return null;
    entries.push({ route, data: msg.slice(o, o + len) });
    o += len;
  }
  return { sync: (msg[3]! & FRAME_FLAG_SYNC) !== 0, entries };
}
