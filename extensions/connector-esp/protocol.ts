/**
 * Pixelmapper ESP32 firmware protocol (ADR D16: firmware encodings belong
 * to connector extensions). Every packet is framed as
 * `[0xAA][0x55][type][len_lo][len_hi][payload…]`.
 *
 * Since plan P6.2 the app streams rendered output instead of on-device
 * rendering packets (layout/channels/modifiers, BPM, timesync are gone):
 *   0x21 DMX_FRAME   [universe u8][512 bytes]           (USB serial nodes)
 *   0x22 PIXEL_FRAME [slot u8][count u16][bytes…]        (WebSocket strip nodes)
 * The firmware projects (`pio`, `pio-ws`, …) have to implement these (out of scope here).
 */

export const TYPE_VERSION_REQ = 0x11;
export const TYPE_OTA_BEGIN = 0x15;
export const TYPE_OTA_CHUNK = 0x16;
export const TYPE_OTA_END = 0x17;
export const TYPE_UNIVERSE_MAP = 0x18;
export const TYPE_STRIP_SLOTS = 0x1a;
export const TYPE_COLOR_CMD = 0x20;
export const TYPE_DMX_FRAME = 0x21;
export const TYPE_PIXEL_FRAME = 0x22;

/** Chip ids in TYPE_STRIP_SLOTS (firmware v1 only honours WS2812B = 0). */
export const STRIP_CHIP_TYPE_ID: Record<string, number> = {
  'WS2812B': 0,
  'WS2811': 1,
  'SK6812-RGB': 2,
  'SK6812-RGBW': 3,
  'APA102': 4,
};

/** Frames a payload. */
export function frame(type: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0xaa;
  out[1] = 0x55;
  out[2] = type;
  out[3] = payload.length & 0xff;
  out[4] = (payload.length >> 8) & 0xff;
  out.set(payload, 5);
  return out;
}

/** Little-endian u16 into `buf` at `o`. */
function u16(buf: Uint8Array, o: number, v: number): void {
  const x = Math.max(0, Math.min(65535, Math.round(v)));
  buf[o] = x & 0xff;
  buf[o + 1] = (x >> 8) & 0xff;
}

/** Asks the device to print `[version] X.Y.Z`. */
export function versionRequest(): Uint8Array {
  return frame(TYPE_VERSION_REQ);
}

/** OTA start: total image size (u32). */
export function otaBegin(totalSize: number): Uint8Array {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setUint32(0, totalSize, true);
  return frame(TYPE_OTA_BEGIN, p);
}

/** One OTA chunk. */
export function otaChunk(chunk: Uint8Array): Uint8Array {
  return frame(TYPE_OTA_CHUNK, chunk);
}

/** OTA end (device reboots). */
export function otaEnd(): Uint8Array {
  return frame(TYPE_OTA_END);
}

/** Universes the node outputs: [count, u1, u2, …]. */
export function universeMap(universes: number[]): Uint8Array {
  return frame(TYPE_UNIVERSE_MAP, Uint8Array.from([universes.length, ...universes.map(u => u & 0xff)]));
}

/** One rendered universe for a serial node. */
export function dmxFrame(universe: number, data: Uint8Array): Uint8Array {
  const p = new Uint8Array(1 + 512);
  p[0] = universe & 0xff;
  p.set(data.subarray(0, 512), 1);
  return frame(TYPE_DMX_FRAME, p);
}

/** Strip slot layout of a WebSocket strip node. */
export interface StripSlotPayload {
  pin: number;
  chipType: string;
  ledCount: number;
  groupSize: number;
  ledsPerMeter: number;
}

/** [count] then 8 bytes per slot: pin, chip, ledCount u16, groupSize u16, ledsPerMeter u16. */
export function stripSlots(slots: StripSlotPayload[]): Uint8Array {
  const n = Math.min(slots.length, 255);
  const p = new Uint8Array(1 + n * 8);
  p[0] = n;
  slots.slice(0, n).forEach((s, i) => {
    const o = 1 + i * 8;
    p[o] = s.pin & 0xff;
    p[o + 1] = STRIP_CHIP_TYPE_ID[s.chipType] ?? 0;
    u16(p, o + 2, s.ledCount);
    u16(p, o + 4, Math.max(1, s.groupSize));
    u16(p, o + 6, s.ledsPerMeter);
  });
  return frame(TYPE_STRIP_SLOTS, p);
}

/** Rendered pixel bytes (RGB/RGBW per logical pixel) for one strip slot. */
export function pixelFrame(slot: number, bytes: Uint8Array): Uint8Array {
  const p = new Uint8Array(3 + bytes.length);
  p[0] = slot & 0xff;
  u16(p, 1, bytes.length);
  p.set(bytes, 3);
  return frame(TYPE_PIXEL_FRAME, p);
}

/** ESP-NOW bridge color command: r, g, b, brightness. */
export function colorCommand(r: number, g: number, b: number, brightness: number): Uint8Array {
  return frame(TYPE_COLOR_CMD, Uint8Array.from([r & 0xff, g & 0xff, b & 0xff, brightness & 0xff]));
}
