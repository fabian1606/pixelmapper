/**
 * Firmware version ids of our devices (plan D17, image-format §1).
 *
 * `FW_VERSION_ID` is `0x00MMmmpp` — the same number a tube reports as
 * DEVICE_INFO `softwareVersionId` and the image trailer carries at 0x17F8.
 * Because major, minor and patch sit in descending bytes, numeric order is
 * version order, so ids are compared as numbers.
 */
import { PM_DEVICE } from '../bridge/rdm-constants';
import type { FirmwareImageInfo } from '../bridge/protocol-model';

/** Largest id in the `0x00MMmmpp` format. */
const MAX_VERSION_ID = 0x00ff_ffff;

/** True when `id` is a `0x00MMmmpp` version id (upper byte zero). */
export function isFirmwareVersionId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id <= MAX_VERSION_ID;
}

/** Major, minor and patch of a `0x00MMmmpp` id; null for other numbers. */
export function firmwareVersionParts(id: number): { major: number; minor: number; patch: number } | null {
  if (!isFirmwareVersionId(id)) return null;
  return { major: (id >> 16) & 0xff, minor: (id >> 8) & 0xff, patch: id & 0xff };
}

/**
 * `"M.m.p"` of a `0x00MMmmpp` id (e.g. `0x010200` → `"1.2.0"`). Ids of other
 * devices that do not follow the format are shown raw as `0x…` (8 digits).
 */
export function formatFirmwareVersion(id: number): string {
  const parts = firmwareVersionParts(id);
  if (parts) return `${parts.major}.${parts.minor}.${parts.patch}`;
  if (Number.isInteger(id) && id >= 0 && id <= 0xffff_ffff) return `0x${id.toString(16).toUpperCase().padStart(8, '0')}`;
  return String(id);
}

/** Id of a `"M.m.p"` string (each part 0–255); null when malformed. */
export function parseFirmwareVersion(text: string): number | null {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(text);
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major > 255 || minor > 255 || patch > 255) return null;
  return (major << 16) | (minor << 8) | patch;
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export function compareFirmwareVersions(a: number, b: number): number {
  return Math.sign(a - b);
}

/** Hex label of a 16-bit id, e.g. `0x7FF0`. */
export function hex16(value: number): string {
  return `0x${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Display name of the device an image is built for (`XBAR500 LED tube`, else ids). */
export function describeImageModel(image: Pick<FirmwareImageInfo, 'manufacturerId' | 'modelId'>): string {
  if (image.manufacturerId === PM_DEVICE.ESTA_MANUFACTURER && image.modelId === PM_DEVICE.MODEL_TUBE) return 'XBAR500 LED tube';
  if (image.manufacturerId === PM_DEVICE.ESTA_MANUFACTURER && image.modelId === PM_DEVICE.MODEL_NODE) return 'Pixelmapper Node';
  return `Model ${hex16(image.modelId)} of manufacturer ${hex16(image.manufacturerId)}`;
}
