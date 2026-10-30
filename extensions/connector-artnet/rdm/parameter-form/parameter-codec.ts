/**
 * Value codec of the generic RDM parameter form: field UI value ↔ the
 * bridge's `rdmGet`/`rdmSet` data (decoded `RdmValue` and hex `data`).
 *
 * - **Read:** the bridge's decoded `value` is used when it has the expected
 *   JS type; otherwise the hex `data` (always present, contract §4) is
 *   decoded from the field's PARAMETER_DESCRIPTION. Standard PIDs such as
 *   DISPLAY_LEVEL only ever come as hex.
 * - **Write:** always hex `data` encoded from the description (E1.20,
 *   big-endian). The bridge accepts `data` for every PID, and it avoids the
 *   bool/number ambiguity of 0–1 PIDs (`pids.toml` type `bool`, described
 *   as uint8). `toRdmValue` gives the decoded form for callers that need it.
 */
import type { RdmValue } from '../../bridge/protocol-model';
import type { RdmFieldValue, RdmParameterField } from './field-types';
import { displayToRaw, formatWithUnit, rawToDisplay } from './rdm-units';
import {
  RdmValueError,
  asciiToBytes,
  bytesToAscii,
  bytesToHex,
  decodeInt,
  encodeInt,
  groupHex,
  hexToBytes,
  intRange,
  isPrintableAscii,
  normalizeHex,
} from './wire-bytes';

/** What `rdmGet` answers (and `rdmQueued` carries). */
export interface RdmReading {
  data: string;
  value?: RdmValue;
}

// ── Decode ─────────────────────────────────────

/** Raw integer of an integer-like field from a reading. */
function readInt(field: Extract<RdmParameterField, { layout: unknown }>, reading: RdmReading): number {
  if (typeof reading.value === 'number') return reading.value;
  if (typeof reading.value === 'boolean') return reading.value ? 1 : 0;
  return decodeInt(hexToBytes(reading.data), field.layout);
}

/** Reading → UI value of `field`. Throws `RdmValueError` on data that does not fit the description. */
export function decodeFieldValue(field: RdmParameterField, reading: RdmReading): RdmFieldValue {
  switch (field.kind) {
    case 'number': return rawToDisplay(readInt(field, reading), field.scale);
    case 'boolean': return typeof reading.value === 'boolean' ? reading.value : readInt(field, reading) !== 0;
    case 'enum':
    case 'bitField': return readInt(field, reading);
    case 'string': return typeof reading.value === 'string' ? reading.value : bytesToAscii(hexToBytes(reading.data));
    case 'raw': {
      const hex = normalizeHex(reading.data);
      if (hex === null) throw new RdmValueError('Malformed hex data');
      return hex;
    }
    case 'action': return '';
  }
}

// ── Encode ─────────────────────────────────────

/** Raw integer of an integer-like UI value. */
function rawInt(field: RdmParameterField, value: RdmFieldValue): number {
  if (field.kind === 'number') return displayToRaw(Number(value), field.scale);
  if (field.kind === 'boolean') return value ? 1 : 0;
  return Number(value);
}

/** UI value → hex `data` for `rdmSet`. Throws `RdmValueError` when the value cannot be encoded. */
export function encodeFieldData(field: RdmParameterField, value: RdmFieldValue): string {
  switch (field.kind) {
    case 'number':
    case 'boolean':
    case 'enum':
    case 'bitField': return bytesToHex(encodeInt(rawInt(field, value), field.layout));
    case 'string': {
      const text = String(value);
      if (!isPrintableAscii(text)) throw new RdmValueError('Only ASCII characters are allowed');
      return bytesToHex(asciiToBytes(text));
    }
    case 'raw': {
      const hex = normalizeHex(String(value));
      if (hex === null) throw new RdmValueError('Malformed hex data');
      return hex;
    }
    case 'action': return '';
  }
}

/** UI value → the bridge's decoded `RdmValue` (undefined for raw data and actions, which are hex only). */
export function toRdmValue(field: RdmParameterField, value: RdmFieldValue): RdmValue | undefined {
  switch (field.kind) {
    case 'number':
    case 'enum':
    case 'bitField': return rawInt(field, value);
    case 'boolean': return Boolean(value);
    case 'string': return String(value);
    default: return undefined;
  }
}

// ── Validation and display ─────────────────────

/** Why `value` cannot be written to `field` (English), or null when it can. */
export function validateFieldValue(field: RdmParameterField, value: RdmFieldValue): string | null {
  switch (field.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number';
      const raw = displayToRaw(value, field.scale);
      if (raw < field.rawMin || raw > field.rawMax) return `Must be between ${formatWithUnit(field.min, field.scale)} and ${formatWithUnit(field.max, field.scale)}`;
      return null;
    }
    case 'boolean': return typeof value === 'boolean' ? null : 'Expected on or off';
    case 'enum': return field.options.some(o => o.value === value) ? null : 'Pick one of the listed values';
    case 'bitField': {
      const [min, max] = intRange(field.layout);
      return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? null : `Must be 0x0–0x${max.toString(16)}`;
    }
    case 'string': {
      if (typeof value !== 'string') return 'Expected text';
      if (value.length > field.maxLength) return `At most ${field.maxLength} characters`;
      return isPrintableAscii(value) ? null : 'Only ASCII characters are allowed';
    }
    case 'raw': {
      const hex = typeof value === 'string' ? normalizeHex(value) : null;
      if (hex === null) return 'Enter hex bytes, e.g. 01 a0 ff';
      return field.maxBytes !== null && hex.length / 2 > field.maxBytes ? `At most ${field.maxBytes} bytes` : null;
    }
    case 'action': return null;
  }
}

/** Display text of a value, e.g. `176 µs`, `On`, `Net:Sub:Uni`, `01 a0 ff`. */
export function formatFieldValue(field: RdmParameterField, value: RdmFieldValue): string {
  switch (field.kind) {
    case 'number': return formatWithUnit(Number(value), field.scale);
    case 'boolean': return value ? 'On' : 'Off';
    case 'enum': return field.options.find(o => o.value === value)?.label ?? `Unknown (${value})`;
    case 'bitField': return formatBitField(Number(value), field.layout.bytes);
    case 'string': return String(value) || '(empty)';
    case 'raw': return groupHex(String(value)) || '(empty)';
    case 'action': return '';
  }
}

/** Bit field as hex with all digits of its width, e.g. `0x05` / `0x0105`. */
export function formatBitField(value: number, bytes: number): string {
  return `0x${(value >>> 0).toString(16).padStart(bytes * 2, '0')}`;
}

/** Parses a bit field typed as `0x…`, `0b…` or decimal; null when malformed. */
export function parseBitField(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^0b[01]+$/.test(t)) return Number.parseInt(t.slice(2), 2);
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}
