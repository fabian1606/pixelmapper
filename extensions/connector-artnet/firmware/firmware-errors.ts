/**
 * English messages of firmware update failures: the `flash`/`imageInfo`
 * pre-check errors and the `error` of a failed job (bridge contract §6,
 * §8). RDM and connection errors reuse the parameter form's messages.
 */
import { BridgeCommandError } from '../bridge/backend';
import type { ErrorCode } from '../bridge/protocol-messages';
import { describeRdmError } from '../rdm/parameter-form/rdm-errors';
import { formatFirmwareVersion } from './firmware-version';

/** A failure for the UI: the main line and the bridge's own text (tooltip), if it adds anything. */
export interface FlashErrorText {
  message: string;
  detail: string | null;
}

/** Messages of the firmware-specific error codes. */
const FLASH_CODE_MESSAGES: Readonly<Record<string, string>> = {
  invalidImage: 'The file is not a valid tube firmware image',
  deviceMismatch: 'The device\'s manufacturer or model does not match the image',
  downgrade: 'The image is older than the installed firmware',
  busy: 'Another firmware update is running on this port',
  unknownJob: 'The bridge no longer knows this update',
};

/** `details.current` / `details.image` of a `downgrade` error as versions. */
function downgradeMessage(details: Record<string, unknown>): string | null {
  const { current, image } = details;
  if (typeof current !== 'number' || typeof image !== 'number') return null;
  return `The image (${formatFirmwareVersion(image)}) is older than the installed firmware (${formatFirmwareVersion(current)})`;
}

/** The bridge text when it says more than the main line. */
function extra(message: string, raw: string | undefined): string | null {
  const text = raw?.trim();
  return text && text !== message ? text : null;
}

/** Message of anything `imageInfo`, `flash` or `flashCancel` can reject with. */
export function describeFlashError(err: unknown): FlashErrorText {
  if (err instanceof BridgeCommandError) {
    const known = (err.code === 'downgrade' ? downgradeMessage(err.details) : null) ?? FLASH_CODE_MESSAGES[err.code];
    if (known) return { message: known, detail: extra(known, err.message) };
  }
  const message = describeRdmError(err);
  return { message, detail: err instanceof Error ? extra(message, err.message) : null };
}

/** Message of the `error` of a failed job (`{ code, message }` from the bridge). */
export function describeJobError(error: { code: string; message: string } | null): FlashErrorText {
  if (!error) return { message: 'The update failed', detail: null };
  const known = FLASH_CODE_MESSAGES[error.code];
  if (known) return { message: known, detail: extra(known, error.message) };
  // RDM and connection codes (timeout, nack, badResponse, …) have generic texts;
  // for unknown codes the bridge's message is the best we have.
  const generic = describeRdmError(new BridgeCommandError(error.code as ErrorCode, error.message));
  return { message: generic, detail: extra(generic, error.message) };
}
