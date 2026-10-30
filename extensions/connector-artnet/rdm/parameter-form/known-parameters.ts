/**
 * What the generic RDM parameter form knows without asking the device.
 *
 * - **Standard PIDs** (E1.20, E1.37-1, E1.37-5): devices never describe
 *   them with PARAMETER_DESCRIPTION, so the simple single-value ones are
 *   described here from the standard. Standard PIDs not listed are not
 *   shown (complex layouts, protocol internals such as QUEUED_MESSAGE, and
 *   PIDs with dedicated UI).
 * - **Our hardware** (`pixelmapper-hardware/protocol/pids.toml`, the only
 *   manufacturer PIDs Pixelmapper may hard-code): the tube bootloader PIDs
 *   (never shown), the node PIDs driven by dedicated flows, and value tables
 *   / bool fields of node PIDs that PARAMETER_DESCRIPTION cannot express.
 */
import type { RdmParameterDescription } from '../../bridge/protocol-model';
import { PM_DEVICE, RDM_PID } from '../../bridge/rdm-constants';
import { INT_DATA_TYPE_CODES, INT_LAYOUTS, intRange } from './wire-bytes';

// ── Shared shapes ──────────────────────────────

/** One entry of a value table (enum). */
export interface RdmEnumOption {
  /** Raw value on the wire. */
  value: number;
  /** English label. */
  label: string;
}

/** Integer data types a known standard PID can have. */
export type KnownIntType = 'uint8' | 'uint16' | 'uint32';

/** A standard PID described from the standard (see file comment). */
export interface KnownStandardParameter {
  pid: number;
  /** Spec name, e.g. `DISPLAY_LEVEL`. */
  name: string;
  /** English UI label. */
  label: string;
  dataType: KnownIntType;
  commandClass: 'get' | 'set' | 'getSet';
  /** E1.20 unit / prefix codes (default none). */
  unit?: number;
  prefix?: number;
  /** Valid range (default: the data type's range). */
  min?: number;
  max?: number;
  default?: number;
  /** Value table → enum field. */
  options?: readonly RdmEnumOption[];
  /** 0 = off, 1 = on → boolean field. */
  boolean?: true;
}

/** Extra knowledge applied on top of a device's PARAMETER_DESCRIPTION. */
export interface ParameterOverride {
  /** Better English label than the device's 32-character description. */
  label?: string;
  /** Value table → enum field. */
  options?: readonly RdmEnumOption[];
  /** The field is a bool (pids.toml type `bool`, described as uint8 0–1). */
  boolean?: true;
}

// ── Standard PIDs ──────────────────────────────

/** E1.20 unit code SECOND. */
const UNIT_SECOND = 0x15;

/**
 * Standard PIDs with dedicated UI elsewhere (fixture fields, inspector):
 * never part of the generic form, even if a device describes them.
 */
export const DEDICATED_STANDARD_PIDS: ReadonlySet<number> = new Set([
  RDM_PID.DMX_START_ADDRESS,
  RDM_PID.DMX_PERSONALITY,
  RDM_PID.IDENTIFY_DEVICE,
  RDM_PID.DEVICE_LABEL,
]);

/** Simple single-value standard PIDs (E1.20 §10, E1.37-1, E1.37-5), by PID. */
export const KNOWN_STANDARD_PARAMETERS: ReadonlyMap<number, KnownStandardParameter> = new Map(([
  { pid: 0x0342, name: 'MAXIMUM_LEVEL', label: 'Maximum level', dataType: 'uint16', commandClass: 'getSet' },
  { pid: 0x0400, name: 'DEVICE_HOURS', label: 'Device hours', dataType: 'uint32', commandClass: 'getSet' },
  { pid: 0x0401, name: 'LAMP_HOURS', label: 'Lamp hours', dataType: 'uint32', commandClass: 'getSet' },
  { pid: 0x0402, name: 'LAMP_STRIKES', label: 'Lamp strikes', dataType: 'uint32', commandClass: 'getSet' },
  {
    pid: 0x0403, name: 'LAMP_STATE', label: 'Lamp state', dataType: 'uint8', commandClass: 'getSet',
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }, { value: 2, label: 'Strike' }, { value: 3, label: 'Standby' }, { value: 4, label: 'Not present' }, { value: 0x7f, label: 'Error' }],
  },
  {
    pid: 0x0404, name: 'LAMP_ON_MODE', label: 'Lamp on mode', dataType: 'uint8', commandClass: 'getSet',
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'DMX' }, { value: 2, label: 'On' }, { value: 3, label: 'On after calibration' }],
  },
  { pid: 0x0405, name: 'DEVICE_POWER_CYCLES', label: 'Power cycles', dataType: 'uint32', commandClass: 'getSet' },
  { pid: 0x0440, name: 'BURN_IN', label: 'Burn-in hours', dataType: 'uint8', commandClass: 'getSet' },
  {
    pid: 0x0500, name: 'DISPLAY_INVERT', label: 'Display invert', dataType: 'uint8', commandClass: 'getSet',
    options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }, { value: 2, label: 'Auto' }],
  },
  { pid: 0x0501, name: 'DISPLAY_LEVEL', label: 'Display level', dataType: 'uint8', commandClass: 'getSet', default: 255 },
  { pid: 0x0600, name: 'PAN_INVERT', label: 'Pan invert', dataType: 'uint8', commandClass: 'getSet', boolean: true },
  { pid: 0x0601, name: 'TILT_INVERT', label: 'Tilt invert', dataType: 'uint8', commandClass: 'getSet', boolean: true },
  { pid: 0x0602, name: 'PAN_TILT_SWAP', label: 'Pan/tilt swap', dataType: 'uint8', commandClass: 'getSet', boolean: true },
  {
    pid: 0x1010, name: 'POWER_STATE', label: 'Power state', dataType: 'uint8', commandClass: 'getSet', default: 0xff,
    options: [{ value: 0, label: 'Full off' }, { value: 1, label: 'Shutdown' }, { value: 2, label: 'Standby' }, { value: 0xff, label: 'Normal' }],
  },
  {
    pid: 0x1040, name: 'IDENTIFY_MODE', label: 'Identify mode', dataType: 'uint8', commandClass: 'getSet',
    options: [{ value: 0, label: 'Quiet' }, { value: 0xff, label: 'Loud' }],
  },
  {
    pid: 0x1043, name: 'PRESET_MERGEMODE', label: 'Preset merge mode', dataType: 'uint8', commandClass: 'getSet',
    options: [{ value: 0, label: 'Default' }, { value: 1, label: 'HTP' }, { value: 2, label: 'LTP' }, { value: 3, label: 'DMX only' }, { value: 0xff, label: 'Other' }],
  },
  { pid: 0x1044, name: 'POWER_ON_SELF_TEST', label: 'Power-on self test', dataType: 'uint8', commandClass: 'getSet', boolean: true },
  { pid: 0x1050, name: 'IDENTIFY_TIMEOUT', label: 'Identify timeout', dataType: 'uint16', commandClass: 'getSet', unit: UNIT_SECOND },
] satisfies KnownStandardParameter[]).map(p => [p.pid, p]));

/**
 * PARAMETER_DESCRIPTION equivalent of a known standard PID, so standard and
 * manufacturer PIDs go through the same field builder.
 */
export function standardDescription(p: KnownStandardParameter): RdmParameterDescription {
  const layout = INT_LAYOUTS[p.dataType];
  const [typeMin, typeMax] = intRange(layout);
  return {
    pid: p.pid,
    pdlSize: layout.bytes,
    dataType: INT_DATA_TYPE_CODES[p.dataType],
    dataTypeName: p.dataType,
    commandClass: p.commandClass,
    type: 0,
    unit: p.unit ?? 0,
    prefix: p.prefix ?? 0,
    minValue: p.min ?? (p.boolean ? 0 : typeMin),
    maxValue: p.max ?? (p.boolean ? 1 : typeMax),
    defaultValue: p.default ?? 0,
    description: p.label,
  };
}

// ── Our hardware (pids.toml) ───────────────────

/**
 * Tube bootloader PIDs (pids.toml: ENTER_BOOTLOADER 0x8000, BOOT_INFO,
 * BOOT_WRITE_PAGE, BOOT_APP_CRC, BOOT_FINISH 0x8010–0x8013). Only the
 * firmware update drives them; the form never shows them, for any device,
 * because one wrong SET leaves a tube in its bootloader.
 */
export const TUBE_BOOTLOADER_PIDS: ReadonlySet<number> = new Set([0x8000, 0x8010, 0x8011, 0x8012, 0x8013]);

/**
 * Node PIDs that only make sense inside a dedicated flow (BOOT_CATCH_START,
 * BOOT_CATCH_ABORT, FW_BEGIN, FW_WRITE, FW_FINISH); hidden for the node.
 * Their read-only companions (BOOT_CATCH_STATUS, LOCAL_RDM_SET, FW_INFO)
 * stay visible as raw data.
 */
export const NODE_FLOW_PIDS: ReadonlySet<number> = new Set([0x8140, 0x8142, 0x8181, 0x8182, 0x8183]);

/** pids.toml PIDs of type `bool`: PORTn_ENABLED, PORTn_RDM_BG_DISCOVERY, PANEL_LOCK. */
const NODE_BOOL_PIDS = [0x8101, 0x8102, 0x8103, 0x8104, 0x8120, 0x8121, 0x8122, 0x8123, 0x8132];

/** Overrides of node PIDs (pids.toml), by PID. */
const NODE_OVERRIDES: ReadonlyMap<number, ParameterOverride> = new Map<number, ParameterOverride>([
  ...NODE_BOOL_PIDS.map(pid => [pid, { boolean: true }] as const),
  // DISPLAY_ADDRESS_FORMAT, enum `address_format`.
  [0x8131, { label: 'Display address format', options: [{ value: 0, label: 'Net:Sub:Uni' }, { value: 1, label: '15-bit number' }] }],
]);

/** True for the Pixelmapper Node (manufacturer PIDs from pids.toml apply). */
export function isPixelmapperNode(manufacturerId: number, modelId: number): boolean {
  return manufacturerId === PM_DEVICE.ESTA_MANUFACTURER && modelId === PM_DEVICE.MODEL_NODE;
}

/** pids.toml knowledge about a manufacturer PID of the given device, if any. */
export function manufacturerOverride(manufacturerId: number, modelId: number, pid: number): ParameterOverride | undefined {
  return isPixelmapperNode(manufacturerId, modelId) ? NODE_OVERRIDES.get(pid) : undefined;
}
