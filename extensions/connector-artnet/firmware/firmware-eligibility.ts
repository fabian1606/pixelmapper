/**
 * Which tubes an image may be written to (plan D17, image-format §1).
 *
 * Manufacturer (upper 16 bits of the UID) and model (DEVICE_INFO) must
 * match the image trailer — otherwise the tube is not offered. The version
 * decides the default: newer image → update (preselected), same → up to
 * date, older → downgrade (needs explicit confirmation). The bridge repeats
 * all of these checks before it writes anything (`deviceMismatch`,
 * `downgrade`), so the UI cannot flash a wrong device by accident.
 */
import type { FirmwareImageInfo, RdmUid } from '../bridge/protocol-model';
import { uidManufacturer } from '../rdm/parameter-form/parameter-fields';
import { compareFirmwareVersions, formatFirmwareVersion, hex16 } from './firmware-version';

/** What is known about a tube's installed firmware. */
export type TubeReading =
  /** DEVICE_INFO is being read. */
  | { state: 'loading' }
  /** DEVICE_INFO (and SOFTWARE_VERSION_LABEL, if supported) answered. */
  | { state: 'ok'; deviceModelId: number; softwareVersionId: number; softwareVersionLabel: string | null }
  /** DEVICE_INFO failed (offline, or the tube waits in its bootloader). */
  | { state: 'error'; message: string };

/** Kind of a tube's eligibility for an image. */
export type FirmwareEligibilityKind =
  | 'update'
  | 'upToDate'
  | 'downgrade'
  | 'bootloader'
  | 'unknown'
  | 'mismatch'
  | 'loading';

/** Whether and how a tube can get an image. */
export interface FirmwareEligibility {
  kind: FirmwareEligibilityKind;
  /** May be selected. */
  selectable: boolean;
  /** Selected by default. */
  preselect: boolean;
  /** Writing it is a downgrade (needs confirmation, `allowDowngrade`). */
  downgrade: boolean;
  /** Short status, e.g. `Update`, `Up to date`. */
  label: string;
  /** Why it is not offered or what to know; null when nothing to add. */
  reason: string | null;
}

/** Extra knowledge about the tube. */
export interface EligibilityContext {
  /** A previous job left the tube in its bootloader (failed or cancelled). */
  inBootloader?: boolean;
}

/** Builds an eligibility (keeps the cases below short). */
function result(kind: FirmwareEligibilityKind, label: string, reason: string | null, flags: Partial<Pick<FirmwareEligibility, 'selectable' | 'preselect' | 'downgrade'>> = {}): FirmwareEligibility {
  return { kind, label, reason, selectable: flags.selectable ?? false, preselect: flags.preselect ?? false, downgrade: flags.downgrade ?? false };
}

/** Eligibility of the tube `uid` with what was read from it for `image`. */
export function checkFirmwareEligibility(image: FirmwareImageInfo, uid: RdmUid, reading: TubeReading, context: EligibilityContext = {}): FirmwareEligibility {
  // The manufacturer is part of the UID, so this check needs no answer from the tube.
  const manufacturer = uidManufacturer(uid);
  if (manufacturer !== image.manufacturerId) {
    return result('mismatch', 'Other manufacturer', `Manufacturer ${hex16(manufacturer)} — the image is for ${hex16(image.manufacturerId)}`);
  }
  if (reading.state === 'loading') return result('loading', 'Reading…', null);
  if (reading.state === 'error') {
    if (context.inBootloader) {
      return result('bootloader', 'In bootloader', 'The last update did not finish; the tube waits in its bootloader', { selectable: true, preselect: true });
    }
    return result('unknown', 'No device info', `${reading.message}. If the tube waits in its bootloader, the update can still be tried — the bridge checks the model first`, { selectable: true });
  }
  if (reading.deviceModelId !== image.modelId) {
    return result('mismatch', 'Other model', `Model ${hex16(reading.deviceModelId)} — the image is for model ${hex16(image.modelId)}`);
  }
  const order = compareFirmwareVersions(image.versionId, reading.softwareVersionId);
  if (order > 0) return result('update', 'Update', null, { selectable: true, preselect: true });
  if (order === 0) return result('upToDate', 'Up to date', `Already runs ${formatFirmwareVersion(image.versionId)}`, { selectable: true });
  return result('downgrade', 'Downgrade', `Installed ${formatFirmwareVersion(reading.softwareVersionId)} is newer than the image`, { selectable: true, downgrade: true });
}
