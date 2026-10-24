/**
 * Field model of the generic RDM parameter form (plan M7.1, D8, D18).
 *
 * `buildParameterFields` turns an `RdmDeviceDescription` (bridge
 * `rdmDescribe`) into the list of parameters the form shows: every PID in
 * SUPPORTED_PARAMETERS that is a manufacturer PID (described by the device's
 * PARAMETER_DESCRIPTION) or a simple standard PID (described from the
 * standard, `known-parameters.ts`). Pure TypeScript, no Vue.
 */
import type { RdmDeviceDescription, RdmParameterDescription } from '../../bridge/protocol-model';
import { isManufacturerPid } from '../../bridge/rdm-constants';
import {
  DEDICATED_STANDARD_PIDS,
  KNOWN_STANDARD_PARAMETERS,
  NODE_FLOW_PIDS,
  TUBE_BOOTLOADER_PIDS,
  isPixelmapperNode,
  manufacturerOverride,
  standardDescription,
  type ParameterOverride,
} from './known-parameters';
import { displayScale, rawToDisplay } from './rdm-units';
import { INT_LAYOUTS, intRange, type RdmIntLayout } from './wire-bytes';
import type { BuildFieldsOptions, RdmFieldBase, RdmFieldSource, RdmParameterField, RdmRawField } from './field-types';

// ── Building ───────────────────────────────────

/** `0x8110` form of a PID. */
export function formatPid(pid: number): string {
  return `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** ESTA manufacturer id of an RDM UID (`"7FF0:…"`), NaN when malformed. */
export function uidManufacturer(uid: string): number {
  return Number.parseInt(uid.slice(0, 4), 16);
}

/**
 * True when the form may show `pid` of this device: never the tube
 * bootloader PIDs, never standard PIDs with dedicated UI, not the node's
 * flow PIDs, not excluded by the caller.
 */
export function isFormPid(pid: number, node: boolean, exclude: ReadonlySet<number>, only: ReadonlySet<number> | null): boolean {
  if (TUBE_BOOTLOADER_PIDS.has(pid) || DEDICATED_STANDARD_PIDS.has(pid)) return false;
  if (node && NODE_FLOW_PIDS.has(pid)) return false;
  if (exclude.has(pid)) return false;
  return only === null || only.has(pid);
}

/** Builds the form's fields of a device, sorted by PID (see file comment). */
export function buildParameterFields(device: RdmDeviceDescription, options: BuildFieldsOptions = {}): RdmParameterField[] {
  const manufacturer = uidManufacturer(device.uid);
  const model = device.deviceInfo.deviceModelId;
  const node = isPixelmapperNode(manufacturer, model);
  const exclude = new Set(options.exclude ?? []);
  const only = options.only ? new Set(options.only) : null;
  const described = new Map(device.parameterDescriptions.map(d => [d.pid, d]));
  const pids = [...new Set(device.supportedParameters)].sort((a, b) => a - b);

  const fields: RdmParameterField[] = [];
  for (const pid of pids) {
    if (!isFormPid(pid, node, exclude, only)) continue;
    if (isManufacturerPid(pid)) {
      const d = described.get(pid);
      fields.push(d
        ? fieldFromDescription(d, 'device', manufacturerOverride(manufacturer, model, pid))
        : undescribedField(pid, device.errors.find(e => e.pid === pid)?.message ?? null));
      continue;
    }
    const known = KNOWN_STANDARD_PARAMETERS.get(pid);
    if (known) fields.push(fieldFromDescription(standardDescription(known), 'standard', { label: known.label, options: known.options, boolean: known.boolean }));
  }
  return fields;
}

/** Field of a manufacturer PID whose PARAMETER_DESCRIPTION is missing: raw, read-only. */
function undescribedField(pid: number, error: string | null): RdmRawField {
  const key = formatPid(pid);
  return {
    kind: 'raw', pid, key, label: `PID ${key}`, readable: true, writable: false, source: 'undescribed', description: null,
    note: `No parameter description${error ? `: ${error}` : ''}`, maxBytes: null, defaultValue: '',
  };
}

/** Builds one field from a PARAMETER_DESCRIPTION (device or synthesized) plus known overrides. */
export function fieldFromDescription(d: RdmParameterDescription, source: RdmFieldSource, override?: ParameterOverride): RdmParameterField {
  const key = formatPid(d.pid);
  const base: RdmFieldBase = {
    pid: d.pid,
    key,
    label: override?.label ?? (d.description.trim() || `PID ${key}`),
    readable: d.commandClass !== 'set',
    writable: d.commandClass !== 'get',
    source,
    description: d,
    note: null,
  };
  if (base.writable && !base.readable && d.pdlSize === 0) return { ...base, kind: 'action' };
  if (d.dataTypeName === 'ascii') return { ...base, kind: 'string', maxLength: d.pdlSize > 0 ? d.pdlSize : 231, defaultValue: '' };

  const layout = INT_LAYOUTS[d.dataTypeName as keyof typeof INT_LAYOUTS] as RdmIntLayout | undefined;
  if (layout && d.pdlSize === layout.bytes) return integerField(base, d, layout, override);
  if (d.dataTypeName === 'bitField' && (d.pdlSize === 1 || d.pdlSize === 2 || d.pdlSize === 4)) {
    return { ...base, kind: 'bitField', layout: { bytes: d.pdlSize, signed: false }, defaultValue: d.defaultValue >>> 0 };
  }
  // notDefined, manufacturer data types, arrays of integers, unknown types.
  return { ...base, kind: 'raw', maxBytes: d.pdlSize > 0 ? d.pdlSize : null, defaultValue: '' };
}

/** Integer field: enum (value table), boolean (bool / 0–1 without unit) or number. */
function integerField(base: RdmFieldBase, d: RdmParameterDescription, layout: RdmIntLayout, override?: ParameterOverride): RdmParameterField {
  const [typeMin, typeMax] = intRange(layout);
  // min = max = 0 (or min > max) means “no range given”: the data type's range applies.
  const unspecified = (d.minValue === 0 && d.maxValue === 0) || d.minValue > d.maxValue;
  const rawMin = unspecified ? typeMin : Math.max(typeMin, d.minValue);
  const rawMax = unspecified ? typeMax : Math.min(typeMax, d.maxValue);
  const rawDefault = Math.min(rawMax, Math.max(rawMin, d.defaultValue));

  if (override?.options?.length) return { ...base, kind: 'enum', layout, options: override.options, defaultValue: rawDefault };
  const looksBoolean = !layout.signed && d.minValue === 0 && d.maxValue === 1 && d.unit === 0 && d.prefix === 0;
  if (override?.boolean || looksBoolean) return { ...base, kind: 'boolean', layout, defaultValue: rawDefault !== 0 };

  const scale = displayScale(d.unit, d.prefix);
  return {
    ...base,
    kind: 'number',
    layout,
    scale,
    rawMin,
    rawMax,
    min: rawToDisplay(rawMin, scale),
    max: rawToDisplay(rawMax, scale),
    step: scale.factor,
    defaultValue: rawToDisplay(rawDefault, scale),
  };
}
