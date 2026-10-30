// @vitest-environment node
/**
 * Field model of the generic RDM parameter form (plan M7.1): which PIDs are
 * shown, how each data type / unit / prefix becomes a field, read-only vs
 * writable from the command class.
 */
import { describe, expect, it } from 'vitest';
import { buildParameterFields, fieldFromDescription } from './parameter-fields';
import type { RdmParameterField } from './field-types';
import { makeForeignDescription, makeNodeDescription, makeTubeDescription, pd } from './testing/fixtures';

/** Field of `pid` (fails the test when missing). */
function field(fields: RdmParameterField[], pid: number): RdmParameterField {
  const f = fields.find(x => x.pid === pid);
  if (!f) throw new Error(`no field for 0x${pid.toString(16)}`);
  return f;
}

describe('buildParameterFields — which PIDs', () => {
  it('never shows the tube bootloader PIDs, nor address/personality/identify/label', () => {
    const fields = buildParameterFields(makeTubeDescription());
    expect(fields).toEqual([]);
  });

  it('hides the bootloader PID numbers on any device', () => {
    const pids = buildParameterFields(makeForeignDescription()).map(f => f.pid);
    expect(pids).not.toContain(0x8010);
  });

  it('shows the node PIDs sorted, without its flow PIDs and without undescribed standard PIDs', () => {
    const pids = buildParameterFields(makeNodeDescription()).map(f => f.pid);
    // DISPLAY_LEVEL is the only known standard PID of the node; QUEUED_MESSAGE,
    // STATUS_MESSAGES, DEVICE_LABEL, FACTORY_DEFAULTS, LIST_INTERFACES are not in the form.
    expect(pids).toEqual([0x0501, 0x8100, 0x8101, 0x8110, 0x8118, 0x8131, 0x8132, 0x8141]);
  });

  it('honours exclude and only', () => {
    const d = makeNodeDescription();
    expect(buildParameterFields(d, { exclude: [0x8101, 0x0501] }).map(f => f.pid)).not.toContain(0x8101);
    expect(buildParameterFields(d, { only: [0x8110, 0x8118, 0x8183] }).map(f => f.pid)).toEqual([0x8110, 0x8118]);
  });

  it('keeps a manufacturer PID without description as read-only raw data with a note', () => {
    const f = field(buildParameterFields(makeForeignDescription()), 0x800a);
    expect(f).toMatchObject({ kind: 'raw', readable: true, writable: false, source: 'undescribed', label: 'PID 0x800A' });
    expect(f.note).toContain('NACK UNKNOWN_PID');
  });

  it('skips standard PIDs it has no description for (PRODUCT_DETAIL_ID_LIST)', () => {
    expect(buildParameterFields(makeForeignDescription()).map(f => f.pid)).not.toContain(0x0070);
  });
});

describe('buildParameterFields — kinds', () => {
  const node = buildParameterFields(makeNodeDescription());
  const foreign = buildParameterFields(makeForeignDescription());

  it('uint16 with MICRO SECOND keeps the raw number and shows µs', () => {
    expect(field(node, 0x8110)).toMatchObject({
      kind: 'number', readable: true, writable: true, min: 176, max: 352, step: 1, defaultValue: 176, rawMin: 176, rawMax: 352,
      scale: { symbol: 'µs', factor: 1, decimals: 0, specName: 'MICRO SECOND' }, layout: { bytes: 2, signed: false },
    });
  });

  it('uint8 HERTZ without prefix', () => {
    expect(field(node, 0x8118)).toMatchObject({ kind: 'number', min: 1, max: 44, defaultValue: 40, scale: { symbol: 'Hz', factor: 1 } });
  });

  it('int16 with DECI CENTIGRADE folds the prefix into the number', () => {
    expect(field(foreign, 0x8001)).toMatchObject({
      kind: 'number', min: -10, max: 10, step: 0.1, defaultValue: 0, rawMin: -100, rawMax: 100,
      scale: { symbol: '°C', factor: 0.1, decimals: 1 }, layout: { bytes: 2, signed: true },
    });
  });

  it('int8 without a range uses the data type range', () => {
    expect(field(foreign, 0x800b)).toMatchObject({ kind: 'number', min: -128, max: 127 });
  });

  it('uint32 set-only with KILO HERTZ is write-only', () => {
    expect(field(foreign, 0x8008)).toMatchObject({ kind: 'number', readable: false, writable: true, min: 1, max: 40, defaultValue: 20, scale: { symbol: 'kHz' } });
  });

  it('GET-only is read-only', () => {
    expect(field(node, 0x8100)).toMatchObject({ kind: 'number', readable: true, writable: false });
  });

  it('pids.toml bool PIDs and 0–1 integers without unit are booleans', () => {
    expect(field(node, 0x8101)).toMatchObject({ kind: 'boolean', defaultValue: true });
    expect(field(node, 0x8132)).toMatchObject({ kind: 'boolean', defaultValue: false });
    expect(field(foreign, 0x8002)).toMatchObject({ kind: 'boolean', source: 'device' });
  });

  it('DISPLAY_ADDRESS_FORMAT of the node is an enum from pids.toml', () => {
    expect(field(node, 0x8131)).toMatchObject({
      kind: 'enum', label: 'Display address format', options: [{ value: 0, label: 'Net:Sub:Uni' }, { value: 1, label: '15-bit number' }],
    });
  });

  it('the same PID number of a foreign manufacturer gets no pids.toml knowledge', () => {
    const f = fieldFromDescription(pd(0x8131, 'Curve', { maxValue: 3 }), 'device', undefined);
    expect(f).toMatchObject({ kind: 'number', label: 'Curve' });
  });

  it('standard PIDs come from the standard: DISPLAY_LEVEL number, LAMP_STATE enum, PAN_INVERT bool', () => {
    expect(field(node, 0x0501)).toMatchObject({ kind: 'number', source: 'standard', label: 'Display level', min: 0, max: 255, defaultValue: 255 });
    expect(field(foreign, 0x0403)).toMatchObject({ kind: 'enum', label: 'Lamp state' });
    expect(field(foreign, 0x0600)).toMatchObject({ kind: 'boolean', label: 'Pan invert' });
  });

  it('ascii is a string with the PDL as maximum length', () => {
    expect(field(foreign, 0x8007)).toMatchObject({ kind: 'string', maxLength: 16, writable: true });
  });

  it('bitField of 2 bytes', () => {
    expect(field(foreign, 0x8003)).toMatchObject({ kind: 'bitField', layout: { bytes: 2, signed: false } });
  });

  it('notDefined, manufacturer types and integer arrays fall back to raw hex', () => {
    expect(field(foreign, 0x8004)).toMatchObject({ kind: 'raw', maxBytes: 6, writable: true, readable: true });
    expect(field(foreign, 0x8005)).toMatchObject({ kind: 'raw', maxBytes: 4 });
    expect(field(foreign, 0x8009)).toMatchObject({ kind: 'raw', readable: true, writable: false });
    expect(field(node, 0x8141)).toMatchObject({ kind: 'raw', readable: true, writable: false, maxBytes: 14 });
  });

  it('SET without data is an action', () => {
    expect(field(foreign, 0x8006)).toMatchObject({ kind: 'action', readable: false, writable: true });
  });

  it('labels come from the description, else the PID', () => {
    expect(fieldFromDescription(pd(0x8200, '  '), 'device').label).toBe('PID 0x8200');
  });
});
