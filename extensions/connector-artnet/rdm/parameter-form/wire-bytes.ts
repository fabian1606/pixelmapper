/**
 * Byte-level helpers of RDM parameter data: hex strings as the bridge
 * contract uses them (lowercase, no separators) and big-endian integers
 * (E1.20: multi-byte values are big-endian, signed values two's complement).
 */

// ── Errors ─────────────────────────────────────

/** Parameter data that cannot be decoded or a value that cannot be encoded. */
export class RdmValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RdmValueError';
  }
}

// ── Integers ───────────────────────────────────

/** Wire layout of an integer. */
export interface RdmIntLayout {
  bytes: 1 | 2 | 4;
  signed: boolean;
}

/** Layouts of the E1.20 integer data types (DS_UNSIGNED_BYTE … DS_SIGNED_DWORD). */
export const INT_LAYOUTS = {
  uint8: { bytes: 1, signed: false },
  int8: { bytes: 1, signed: true },
  uint16: { bytes: 2, signed: false },
  int16: { bytes: 2, signed: true },
  uint32: { bytes: 4, signed: false },
  int32: { bytes: 4, signed: true },
} as const satisfies Record<string, RdmIntLayout>;

/** E1.20 data type codes (Table A-15) of the integer types. */
export const INT_DATA_TYPE_CODES = { uint8: 0x03, int8: 0x04, uint16: 0x05, int16: 0x06, uint32: 0x07, int32: 0x08 } as const;

/** Inclusive value range of a layout. */
export function intRange(layout: RdmIntLayout): [min: number, max: number] {
  const bits = layout.bytes * 8;
  return layout.signed ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];
}

/** Encodes an integer big-endian (two's complement when signed). Throws when out of range. */
export function encodeInt(value: number, layout: RdmIntLayout): Uint8Array {
  const [min, max] = intRange(layout);
  if (!Number.isInteger(value) || value < min || value > max) throw new RdmValueError(`${value} does not fit ${layout.signed ? 'a signed' : 'an unsigned'} ${layout.bytes * 8}-bit value`);
  const out = new Uint8Array(layout.bytes);
  // Two's complement: negative values wrap into the unsigned range of the width.
  let u = value < 0 ? value + 2 ** (layout.bytes * 8) : value;
  for (let i = layout.bytes - 1; i >= 0; i--) {
    out[i] = u % 256;
    u = Math.floor(u / 256);
  }
  return out;
}

/** Decodes a big-endian integer of exactly `layout.bytes` bytes. */
export function decodeInt(bytes: Uint8Array, layout: RdmIntLayout): number {
  if (bytes.length !== layout.bytes) throw new RdmValueError(`Expected ${layout.bytes} byte${layout.bytes === 1 ? '' : 's'} of data, got ${bytes.length}`);
  let u = 0;
  for (const b of bytes) u = u * 256 + b;
  const full = 2 ** (layout.bytes * 8);
  return layout.signed && u >= full / 2 ? u - full : u;
}

// ── Hex ────────────────────────────────────────

/** Bytes → contract hex (lowercase, no separators). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalizes user or bridge hex: drops a `0x` prefix, whitespace, `:` and
 * `-` separators, lowercases. Null when not an even number of hex digits.
 */
export function normalizeHex(input: string): string | null {
  const hex = input.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '').toLowerCase();
  return /^(?:[0-9a-f]{2})*$/.test(hex) ? hex : null;
}

/** Hex → bytes. Throws `RdmValueError` on malformed hex. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = normalizeHex(hex);
  if (clean === null) throw new RdmValueError('Malformed hex data');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Hex grouped per byte for display, e.g. `01 a0 ff`. */
export function groupHex(hex: string): string {
  return hex.match(/../g)?.join(' ') ?? '';
}

// ── ASCII ──────────────────────────────────────

/** True when every character is printable ASCII (0x20–0x7E), as E1.20 text fields require. */
export function isPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/** ASCII text → bytes (no terminator: the PDL carries the length). */
export function asciiToBytes(text: string): Uint8Array {
  return Uint8Array.from(text, c => c.charCodeAt(0) & 0x7f);
}

/** Bytes → text, ending at the first NUL (E1.20 10.1: a NUL ends the text). */
export function bytesToAscii(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...(end >= 0 ? bytes.subarray(0, end) : bytes));
}
