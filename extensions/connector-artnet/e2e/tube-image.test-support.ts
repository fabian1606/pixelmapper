/**
 * Builds a valid XBAR500 tube firmware image as Intel HEX, exactly like
 * `build_test_image` + `TubeImage::to_hex` of `pixelmapper-net`
 * (`crates/pixelmapper-net/src/image/tube.rs`, `image/ihex.rs`, image
 * format §1): app at 0x0000, 16-byte trailer at 0x17F0 with magic, format,
 * manufacturer, model, version, length and a CRC16 over app + trailer
 * metadata. Used by the end-to-end test to flash a simulated tube.
 *
 * Tests only; never imported by extension runtime code.
 */

/** Start of the 2 KB bootloader section (end of app space). */
const BOOT_START = 0x1800;
/** Start of the 16-byte trailer. */
const TRAILER_START = BOOT_START - 16;
/** Trailer bytes covered by the CRC after the app (0x17F0..0x17FB). */
const TRAILER_META_LEN = 12;
/** Trailer magic (`"PM"` little-endian). */
const TRAILER_MAGIC = 0x4d50;
/** Trailer format. */
const TRAILER_FORMAT = 1;

/** ESTA manufacturer id of the prototype (0x7FF0). */
export const ESTA_MANUFACTURER = 0x7ff0;
/** DEVICE_MODEL_ID of the XBAR500 tube. */
export const MODEL_TUBE = 0x0001;

/** CRC16-CCITT (poly 0x1021, not reflected), continued from `crc`. */
export function crc16Ccitt(data: Uint8Array, crc: number): number {
  let c = crc & 0xffff;
  for (const b of data) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = (c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1) & 0xffff;
  }
  return c;
}

/** A built image: the flash content below the bootloader and the app length. */
export interface TubeImage {
  /** 0x1800 bytes (unused bytes 0xFF). */
  img: Uint8Array;
  /** App length in bytes (even). */
  length: number;
}

/** Writes `value` little-endian into `img` at `offset`. */
function putLe(img: Uint8Array, offset: number, value: number, bytes: number) {
  for (let i = 0; i < bytes; i++) img[offset + i] = (value >>> (8 * i)) & 0xff;
}

/** `build_test_image(app, manufacturer, model, version)`. */
export function buildTestImage(app: Uint8Array, manufacturer: number, model: number, version: number): TubeImage {
  const img = new Uint8Array(BOOT_START).fill(0xff);
  img.set(app, 0);
  const length = (app.length + 1) & ~1;
  const t = TRAILER_START;
  putLe(img, t, TRAILER_MAGIC, 2);
  img[t + 2] = TRAILER_FORMAT;
  img[t + 3] = 0xff;
  putLe(img, t + 4, manufacturer, 2);
  putLe(img, t + 6, model, 2);
  putLe(img, t + 8, version, 4);
  putLe(img, t + 12, length, 2);
  // CRC16 over app 0..length (init 0xFFFF), continued over the trailer metadata.
  const crc = crc16Ccitt(img.subarray(t, t + TRAILER_META_LEN), crc16Ccitt(img.subarray(0, length), 0xffff));
  putLe(img, t + 14, crc, 2);
  return { img, length };
}

/** The recognisable test app of the bridge's sim tests: `(i * 13 + version) as u8` for 1500 bytes. */
export function testApp(version: number, size = 1500): Uint8Array {
  const app = new Uint8Array(size);
  for (let i = 0; i < size; i++) app[i] = (i * 13 + version) & 0xff;
  return app;
}

/** One Intel HEX record line (`:LLAAAATT…CC`). */
function hexRecord(type: number, address: number, data: readonly number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const checksum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
  return `:${[...bytes, checksum].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}\n`;
}

/**
 * `TubeImage::to_hex`: the app bytes below `length` plus the trailer, in
 * 16-byte data records (a run breaks at a gap or a 64 KiB boundary),
 * extended linear address records when the upper 16 bits change, then EOF.
 */
export function imageToIntelHex(image: TubeImage): string {
  const addresses: number[] = [];
  for (let a = 0; a < image.img.length; a++) if (a < image.length || a >= TRAILER_START) addresses.push(a);
  let out = '';
  let upper = 0;
  let i = 0;
  while (i < addresses.length) {
    const a = addresses[i]!;
    if (a >>> 16 !== upper) {
      upper = a >>> 16;
      out += hexRecord(4, 0, [(upper >> 8) & 0xff, upper & 0xff]);
    }
    const data = [image.img[a]!];
    i++;
    while (data.length < 16 && i < addresses.length && addresses[i] === a + data.length && (addresses[i]! & 0xffff) !== 0) {
      data.push(image.img[addresses[i]!]!);
      i++;
    }
    out += hexRecord(0, a & 0xffff, data);
  }
  return out + hexRecord(1, 0, []);
}

/** Intel HEX of a valid tube image with firmware `version` (FW_VERSION_ID 0x00MMmmpp). */
export function tubeImageHex(version: number, model = MODEL_TUBE): string {
  return imageToIntelHex(buildTestImage(testApp(version), ESTA_MANUFACTURER, model, version));
}
