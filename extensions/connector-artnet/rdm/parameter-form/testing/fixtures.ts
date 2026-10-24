/**
 * Builders of `rdmDescribe` results for the parameter form tests: the
 * Pixelmapper Node and the tube as `pids.toml` describes them, and a
 * foreign device covering every data type. Not used at runtime.
 */
import type { RdmDataTypeName, RdmDeviceDescription, RdmDeviceInfo, RdmParameterDescription } from '../../../bridge/protocol-model';

/** E1.20 data type codes by name. */
const DATA_TYPE_CODES: Record<RdmDataTypeName, number> = {
  notDefined: 0x00, bitField: 0x01, ascii: 0x02, uint8: 0x03, int8: 0x04, uint16: 0x05, int16: 0x06, uint32: 0x07, int32: 0x08, manufacturer: 0x80,
};

/** One PARAMETER_DESCRIPTION; defaults: uint8, GET_SET, no unit, 0–255. */
export function pd(pid: number, description: string, o: Partial<RdmParameterDescription> = {}): RdmParameterDescription {
  const dataTypeName = o.dataTypeName ?? 'uint8';
  return {
    pid,
    pdlSize: 1,
    dataType: DATA_TYPE_CODES[dataTypeName],
    dataTypeName,
    commandClass: 'getSet',
    type: 0,
    unit: 0,
    prefix: 0,
    minValue: 0,
    maxValue: 255,
    defaultValue: 0,
    description,
    ...o,
  };
}

/** DEVICE_INFO of a device with `model`. */
function deviceInfo(model: number, footprint: number): RdmDeviceInfo {
  return {
    rdmProtocolVersion: 0x0100, deviceModelId: model, productCategory: 0x0801, softwareVersionId: 0x00010200, dmxFootprint: footprint,
    currentPersonality: 1, personalityCount: 1, dmxStartAddress: footprint ? 1 : 0xffff, subDeviceCount: 0, sensorCount: 0,
  };
}

/** An `rdmDescribe` result. */
export function makeDescription(uid: string, model: number, supported: number[], descriptions: RdmParameterDescription[], o: Partial<RdmDeviceDescription> = {}): RdmDeviceDescription {
  return {
    uid,
    deviceInfo: deviceInfo(model, 0),
    manufacturerLabel: 'Pixelmapper',
    deviceModelDescription: null,
    deviceLabel: null,
    softwareVersionLabel: '1.2.0',
    bootSoftwareVersionId: null,
    bootSoftwareVersionLabel: null,
    personalities: [],
    slots: [],
    supportedParameters: supported,
    parameterDescriptions: descriptions,
    errors: [],
    ...o,
  };
}

/** UID of the test node. */
export const NODE_UID = '7FF0:8A1B2C3D';

/** Node PARAMETER_DESCRIPTIONs as pids.toml generates them (subset: one per kind). */
export const NODE_DESCRIPTIONS: RdmParameterDescription[] = [
  pd(0x8100, 'Hardware revision', { commandClass: 'get' }),
  pd(0x8101, 'Port 1 enabled', { maxValue: 1, defaultValue: 1 }),
  pd(0x8110, 'Port 1 DMX break', { dataTypeName: 'uint16', pdlSize: 2, unit: 0x15, prefix: 0x04, minValue: 176, maxValue: 352, defaultValue: 176 }),
  pd(0x8118, 'Port 1 DMX refresh rate', { unit: 0x08, minValue: 1, maxValue: 44, defaultValue: 40 }),
  pd(0x8131, 'Addr format 0=Net:Sub:Uni 1=15b', { maxValue: 1 }),
  pd(0x8132, 'Front panel locked', { maxValue: 1 }),
  pd(0x8140, 'Boot catch start (port, UID)', { dataTypeName: 'notDefined', pdlSize: 7, commandClass: 'set', maxValue: 0 }),
  pd(0x8141, 'Boot catch status', { dataTypeName: 'notDefined', pdlSize: 14, commandClass: 'get', maxValue: 0 }),
  pd(0x8142, 'Boot catch abort', { dataTypeName: 'notDefined', pdlSize: 0, commandClass: 'set', maxValue: 0 }),
  pd(0x8181, 'Firmware update begin', { dataTypeName: 'notDefined', pdlSize: 64, commandClass: 'set', maxValue: 0 }),
  pd(0x8183, 'Firmware update finish', { dataTypeName: 'notDefined', pdlSize: 0, commandClass: 'set', maxValue: 0 }),
];

/** The Pixelmapper Node (model 0x0002) with standard and manufacturer PIDs. */
export function makeNodeDescription(): RdmDeviceDescription {
  const supported = [0x0020, 0x0030, 0x0082, 0x0090, 0x0501, 0x0700, ...NODE_DESCRIPTIONS.map(d => d.pid)];
  return makeDescription(NODE_UID, 0x0002, supported, NODE_DESCRIPTIONS);
}

/** A tube (model 0x0001): address/personality/label PIDs and ENTER_BOOTLOADER (listed). */
export function makeTubeDescription(): RdmDeviceDescription {
  return makeDescription('7FF0:74B6510C', 0x0001, [0x0082, 0x00e0, 0x00f0, 0x1000, 0x8000, 0x8010], [
    pd(0x8000, 'Enter bootloader (SET "BOOT")', { dataTypeName: 'ascii', pdlSize: 4, commandClass: 'set', maxValue: 0 }),
    pd(0x8010, 'Boot info', { dataTypeName: 'notDefined', pdlSize: 18, commandClass: 'get', maxValue: 0 }),
  ]);
}

/** A foreign device (manufacturer 0x1234) with one PID per data type. */
export function makeForeignDescription(): RdmDeviceDescription {
  const descriptions = [
    pd(0x8001, 'Temperature offset', { dataTypeName: 'int16', pdlSize: 2, unit: 0x01, prefix: 0x01, minValue: -100, maxValue: 100, defaultValue: 0 }),
    pd(0x8002, 'Fan boost', { maxValue: 1 }),
    pd(0x8003, 'Feature flags', { dataTypeName: 'bitField', pdlSize: 2, maxValue: 0 }),
    pd(0x8004, 'Calibration', { dataTypeName: 'notDefined', pdlSize: 6, maxValue: 0 }),
    pd(0x8005, 'Fan speeds', { dataTypeName: 'uint16', pdlSize: 4 }),
    pd(0x8006, 'Reset counters', { dataTypeName: 'notDefined', pdlSize: 0, commandClass: 'set', maxValue: 0 }),
    pd(0x8007, 'Show name', { dataTypeName: 'ascii', pdlSize: 16, maxValue: 0 }),
    pd(0x8008, 'PWM frequency', { dataTypeName: 'uint32', pdlSize: 4, commandClass: 'set', unit: 0x08, prefix: 0x13, minValue: 1, maxValue: 40, defaultValue: 20 }),
    pd(0x8009, 'Vendor blob', { dataTypeName: 'manufacturer', dataType: 0x85, pdlSize: 8, commandClass: 'get', maxValue: 0 }),
    pd(0x800b, 'Trim', { dataTypeName: 'int8', minValue: 0, maxValue: 0 }),
  ];
  return makeDescription('1234:00000001', 0x0005, [0x0070, 0x0403, 0x0600, 0x8010, 0x800a, ...descriptions.map(d => d.pid)], descriptions, {
    errors: [{ pid: 0x800a, code: 'nack', message: 'NACK UNKNOWN_PID', nackReason: 0 }],
  });
}
