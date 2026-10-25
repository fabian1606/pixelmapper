/**
 * Tube firmware update over RDM through the bridge (plan M7.4, D17): the
 * dialog (batch per node, or one tube), the inspector button, the
 * composables, the app-wide update manager and the pure logic behind them
 * (version ids, eligibility, per-port scheduler, progress texts).
 */
export { default as FirmwareUpdateDialog } from './FirmwareUpdateDialog.vue';
export { default as FirmwareUpdatePanel } from './FirmwareUpdatePanel.vue';
export { default as TubeFirmwareButton } from './TubeFirmwareButton.vue';
export {
  useFirmwareUpdate,
  type FirmwareCandidate,
  type FirmwareStartResult,
  type FirmwareUpdateState,
  type UseFirmwareUpdateOptions,
} from './use-firmware-update';
export { MAX_FIRMWARE_FILE_BYTES, useFirmwareImage, type FirmwareFile } from './use-firmware-image';
export { useTubeReadings, type TubeReadingsOptions } from './use-tube-readings';
export { FirmwareUpdateManager, getFirmwareUpdateManager } from './firmware-update-manager';
export { FlashScheduler } from './flash-scheduler';
export {
  holdsPort,
  isItemPending,
  latestItemOf,
  type FlashItem,
  type FlashItemStatus,
  type FlashRequest,
  type FlashRunner,
  type FlashSchedulerOptions,
} from './flash-item';
export {
  checkFirmwareEligibility,
  type EligibilityContext,
  type FirmwareEligibility,
  type FirmwareEligibilityKind,
  type TubeReading,
} from './firmware-eligibility';
export {
  compareFirmwareVersions,
  describeImageModel,
  firmwareVersionParts,
  formatFirmwareVersion,
  hex16,
  isFirmwareVersionId,
  parseFirmwareVersion,
} from './firmware-version';
export { FLASH_PHASE_LABELS, TERMINAL_PHASES, describeFlashPhase, flashProgressFraction, isTerminalPhase } from './flash-progress';
export { describeFlashError, describeJobError, type FlashErrorText } from './firmware-errors';
export { listNodeTubes, readTubeFirmware, type NodeTube, type TubeDirectory } from './tube-devices';
