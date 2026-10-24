/**
 * Standard RDM parameter ids (ANSI E1.20) used with `rdmGet`/`rdmSet`.
 *
 * Only standard PIDs live here. Manufacturer PIDs come from
 * `protocol/pids.toml` (node contract §8) or from PARAMETER_DESCRIPTION at
 * runtime — never hard-code them elsewhere.
 */
export const RDM_PID = {
  QUEUED_MESSAGE: 0x0020,
  STATUS_MESSAGES: 0x0030,
  SUPPORTED_PARAMETERS: 0x0050,
  PARAMETER_DESCRIPTION: 0x0051,
  DEVICE_INFO: 0x0060,
  DEVICE_MODEL_DESCRIPTION: 0x0080,
  MANUFACTURER_LABEL: 0x0081,
  DEVICE_LABEL: 0x0082,
  SOFTWARE_VERSION_LABEL: 0x00c0,
  BOOT_SOFTWARE_VERSION_ID: 0x00c1,
  BOOT_SOFTWARE_VERSION_LABEL: 0x00c2,
  DMX_PERSONALITY: 0x00e0,
  DMX_PERSONALITY_DESCRIPTION: 0x00e1,
  DMX_START_ADDRESS: 0x00f0,
  SLOT_INFO: 0x0120,
  SLOT_DESCRIPTION: 0x0121,
  DEFAULT_SLOT_VALUE: 0x0122,
  IDENTIFY_DEVICE: 0x1000,
} as const;

/** NACK reason names (E1.20 Table A-17, E1.37-2) for messages. */
export const RDM_NACK_REASON: Readonly<Record<number, string>> = {
  0x0000: 'UNKNOWN_PID',
  0x0001: 'FORMAT_ERROR',
  0x0002: 'HARDWARE_FAULT',
  0x0003: 'PROXY_REJECT',
  0x0004: 'WRITE_PROTECT',
  0x0005: 'UNSUPPORTED_COMMAND_CLASS',
  0x0006: 'DATA_OUT_OF_RANGE',
  0x0007: 'BUFFER_FULL',
  0x0008: 'PACKET_SIZE_UNSUPPORTED',
  0x0009: 'SUB_DEVICE_OUT_OF_RANGE',
  0x000a: 'PROXY_BUFFER_FULL',
  0x000b: 'ACTION_NOT_SUPPORTED',
};

/** Manufacturer-specific PID range (E1.20 §10). */
export function isManufacturerPid(pid: number): boolean {
  return pid >= 0x8000 && pid <= 0xffdf;
}
