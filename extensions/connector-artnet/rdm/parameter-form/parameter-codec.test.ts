// @vitest-environment node
/**
 * Value codec of the generic RDM parameter form: units/prefixes, big-endian
 * integers, decode from the bridge's `value` or hex `data`, encode to hex,
 * validation and display, NACK messages.
 */
import { describe, expect, it } from 'vitest';
import { BridgeCommandError } from '../../bridge/backend';
import { buildParameterFields } from './parameter-fields';
import type { RdmFieldValue, RdmParameterField } from './field-types';
import { decodeFieldValue, encodeFieldData, formatFieldValue, parseBitField, toRdmValue, validateFieldValue } from './parameter-codec';
import { describeRdmError } from './rdm-errors';
import { displayScale, formatWithUnit } from './rdm-units';
import { decodeInt, encodeInt, normalizeHex } from './wire-bytes';
import { makeForeignDescription, makeNodeDescription } from './testing/fixtures';

const fields = [...buildParameterFields(makeNodeDescription()), ...buildParameterFields(makeForeignDescription())];

/** Field of `pid`. */
function field(pid: number): RdmParameterField {
  const f = fields.find(x => x.pid === pid);
  if (!f) throw new Error(`no field for 0x${pid.toString(16)}`);
  return f;
}

describe('units and prefixes', () => {
  it('keeps everyday SI prefixes as symbols and folds deci/centi/deca/hecto into the number', () => {
    expect(displayScale(0x15, 0x04)).toMatchObject({ symbol: 'µs', factor: 1, decimals: 0 });
    expect(displayScale(0x15, 0x03)).toMatchObject({ symbol: 'ms', factor: 1 });
    expect(displayScale(0x08, 0x13)).toMatchObject({ symbol: 'kHz', factor: 1 });
    expect(displayScale(0x02, 0x01)).toMatchObject({ symbol: 'V DC', factor: 0.1, decimals: 1 });
    expect(displayScale(0x21, 0x02)).toMatchObject({ symbol: '%', factor: 0.01, decimals: 2 });
    expect(displayScale(0x0c, 0x12)).toMatchObject({ symbol: 'm', factor: 100, decimals: 0 });
    expect(displayScale(0x00, 0x00)).toMatchObject({ symbol: '', factor: 1, specName: 'NONE' });
  });

  it('treats unknown and manufacturer unit codes as unitless', () => {
    expect(displayScale(0x85, 0x00)).toMatchObject({ symbol: '', specName: '0x85' });
  });

  it('formats with SI spacing', () => {
    expect(formatWithUnit(176, displayScale(0x15, 0x04))).toBe('176 µs');
    expect(formatWithUnit(23.5, displayScale(0x02, 0x01))).toBe('23.5 V DC');
    expect(formatWithUnit(40, displayScale(0x21, 0x00))).toBe('40 %');
    expect(formatWithUnit(90, displayScale(0x16, 0x00))).toBe('90°');
  });
});

describe('wire bytes', () => {
  it('encodes and decodes big-endian, signed as two\'s complement', () => {
    expect(Array.from(encodeInt(0x1234, { bytes: 2, signed: false }))).toEqual([0x12, 0x34]);
    expect(Array.from(encodeInt(-2, { bytes: 2, signed: true }))).toEqual([0xff, 0xfe]);
    expect(Array.from(encodeInt(0xfffffffe, { bytes: 4, signed: false }))).toEqual([0xff, 0xff, 0xff, 0xfe]);
    expect(decodeInt(Uint8Array.of(0xff, 0xfe), { bytes: 2, signed: true })).toBe(-2);
    expect(decodeInt(Uint8Array.of(0x80, 0, 0, 0), { bytes: 4, signed: true })).toBe(-0x80000000);
    expect(() => encodeInt(256, { bytes: 1, signed: false })).toThrow(/does not fit/);
    expect(() => decodeInt(Uint8Array.of(1), { bytes: 2, signed: false })).toThrow(/Expected 2 bytes/);
  });

  it('normalizes hex input', () => {
    expect(normalizeHex('0x01 A0:ff')).toBe('01a0ff');
    expect(normalizeHex('abc')).toBeNull();
    expect(normalizeHex('zz')).toBeNull();
  });
});

describe('decode', () => {
  it('prefers the bridge\'s decoded value when it has the expected type', () => {
    expect(decodeFieldValue(field(0x8110), { data: '00b0', value: 176 })).toBe(176);
    expect(decodeFieldValue(field(0x8101), { data: '01', value: true })).toBe(true);
    expect(decodeFieldValue(field(0x8007), { data: '4869', value: 'Hi' })).toBe('Hi');
  });

  it('decodes hex data when there is no (usable) value', () => {
    expect(decodeFieldValue(field(0x0501), { data: 'c8' })).toBe(200);
    expect(decodeFieldValue(field(0x8001), { data: 'ffe7' })).toBe(-2.5);
    expect(decodeFieldValue(field(0x8101), { data: '00' })).toBe(false);
    expect(decodeFieldValue(field(0x8131), { data: '01', value: { offset: 1, description: 'x' } })).toBe(1);
    expect(decodeFieldValue(field(0x8003), { data: '0105' })).toBe(0x0105);
    expect(decodeFieldValue(field(0x8007), { data: '53686f7731000000' })).toBe('Show1');
    expect(decodeFieldValue(field(0x8004), { data: '0102030A0B0C' })).toBe('0102030a0b0c');
  });

  it('rejects data that does not fit the description', () => {
    expect(() => decodeFieldValue(field(0x8110), { data: 'b0' })).toThrow(/Expected 2 bytes/);
    expect(() => decodeFieldValue(field(0x8004), { data: '0' })).toThrow(/Malformed/);
  });
});

describe('encode', () => {
  it('round-trips every kind through hex', () => {
    const cases: [number, RdmFieldValue, string][] = [
      [0x8110, 200, '00c8'],
      [0x8118, 44, '2c'],
      [0x8001, -2.5, 'ffe7'],
      [0x8001, 10, '0064'],
      [0x800b, -128, '80'],
      [0x8008, 40, '00000028'],
      [0x8101, true, '01'],
      [0x8101, false, '00'],
      [0x8131, 1, '01'],
      [0x8003, 0x8001, '8001'],
      [0x8007, 'Show 1', '53686f772031'],
      [0x8007, '', ''],
      [0x8004, '01 02 03', '010203'],
    ];
    for (const [pid, value, hex] of cases) {
      const f = field(pid);
      expect(encodeFieldData(f, value), `0x${pid.toString(16)}`).toBe(hex);
      if (f.readable) expect(decodeFieldValue(f, { data: hex })).toEqual(f.kind === 'raw' ? normalizeHex(String(value)) : value);
    }
  });

  it('rounds displayed values with folded prefixes to the nearest raw step', () => {
    expect(encodeFieldData(field(0x8001), 2.54)).toBe('0019');
  });

  it('gives the decoded RdmValue form', () => {
    expect(toRdmValue(field(0x8110), 200)).toBe(200);
    expect(toRdmValue(field(0x8001), -2.5)).toBe(-25);
    expect(toRdmValue(field(0x8101), true)).toBe(true);
    expect(toRdmValue(field(0x8007), 'x')).toBe('x');
    expect(toRdmValue(field(0x8004), '01')).toBeUndefined();
  });

  it('refuses non-ASCII text', () => {
    expect(() => encodeFieldData(field(0x8007), 'Grün')).toThrow(/ASCII/);
  });
});

describe('validation and display', () => {
  it('validates ranges, lengths, options and hex', () => {
    expect(validateFieldValue(field(0x8110), 176)).toBeNull();
    expect(validateFieldValue(field(0x8110), 400)).toBe('Must be between 176 µs and 352 µs');
    expect(validateFieldValue(field(0x8001), 10.5)).toBe('Must be between -10.0 °C and 10.0 °C');
    expect(validateFieldValue(field(0x8110), Number.NaN)).toBe('Enter a number');
    expect(validateFieldValue(field(0x8131), 2)).toBe('Pick one of the listed values');
    expect(validateFieldValue(field(0x8007), 'x'.repeat(17))).toBe('At most 16 characters');
    expect(validateFieldValue(field(0x8007), 'Grün')).toBe('Only ASCII characters are allowed');
    expect(validateFieldValue(field(0x8004), '01 02 03 04 05 06 07')).toBe('At most 6 bytes');
    expect(validateFieldValue(field(0x8004), 'xyz')).toMatch(/hex bytes/);
    expect(validateFieldValue(field(0x8003), 0x10000)).toBe('Must be 0x0–0xffff');
    expect(validateFieldValue(field(0x8006), '')).toBeNull();
  });

  it('formats values for display', () => {
    expect(formatFieldValue(field(0x8110), 176)).toBe('176 µs');
    expect(formatFieldValue(field(0x8101), true)).toBe('On');
    expect(formatFieldValue(field(0x8131), 0)).toBe('Net:Sub:Uni');
    expect(formatFieldValue(field(0x8131), 7)).toBe('Unknown (7)');
    expect(formatFieldValue(field(0x8003), 5)).toBe('0x0005');
    expect(formatFieldValue(field(0x8004), '0102ff')).toBe('01 02 ff');
    expect(formatFieldValue(field(0x8007), '')).toBe('(empty)');
  });

  it('parses bit fields typed as hex, binary or decimal', () => {
    expect(parseBitField('0x0105')).toBe(0x105);
    expect(parseBitField('0b101')).toBe(5);
    expect(parseBitField('12')).toBe(12);
    expect(parseBitField('1z')).toBeNull();
  });
});

describe('error messages', () => {
  it('explains NACK reasons in English with the reason name', () => {
    expect(describeRdmError(new BridgeCommandError('nack', 'NACK', { nackReason: 4, nackName: 'WRITE_PROTECT' })))
      .toBe('The parameter is write-protected (device locked) (NACK WRITE_PROTECT)');
    expect(describeRdmError(new BridgeCommandError('nack', 'NACK', { nackReason: 6 }))).toBe('The value is out of the device\'s range (NACK DATA_OUT_OF_RANGE)');
    expect(describeRdmError(new BridgeCommandError('nack', 'NACK', { nackReason: 0x14, nackName: 'DEVICE_ABSENT' }))).toBe('The device refused the request (NACK DEVICE_ABSENT)');
  });

  it('explains transport errors', () => {
    expect(describeRdmError(new BridgeCommandError('timeout', 'timeout'))).toBe('No answer from the device');
    expect(describeRdmError(new BridgeCommandError('notConnected', 'not connected'))).toBe('The Art-Net bridge is not connected');
    expect(describeRdmError(new BridgeCommandError('internal', 'bridge bug'))).toBe('bridge bug');
  });
});
