/**
 * Rules of the node's device settings (plan D8, M7.3): name limits of
 * ArtAddress (ShortName ≤ 17, LongName ≤ 63 bytes) and DEVICE_LABEL (≤ 32),
 * firmware version text, and English messages of failed node commands.
 * Pure TypeScript, no Vue.
 */
import { BridgeCommandError } from '../bridge/backend';
import { describeRdmError } from '../rdm/parameter-form/rdm-errors';

// ── Names ──────────────────────────────────────

/** ArtAddress ShortName limit (bridge contract: ≤ 17 bytes). */
export const SHORT_NAME_MAX_BYTES = 17;

/** ArtAddress LongName limit (bridge contract: ≤ 63 bytes). */
export const LONG_NAME_MAX_BYTES = 63;

/** RDM DEVICE_LABEL limit (E1.20: ≤ 32 characters). */
export const DEVICE_LABEL_MAX_BYTES = 32;

/** Printable ASCII: Art-Net names and RDM labels are ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * Why `name` cannot be written, or null. Art-Net treats an empty name as
 * “no change”, so names must not be empty unless `allowEmpty` (DEVICE_LABEL).
 */
export function nameError(name: string, maxBytes: number, allowEmpty = false): string | null {
  if (!allowEmpty && name.trim() === '') return 'Enter a name';
  if (!PRINTABLE_ASCII.test(name)) return 'Use ASCII letters, digits and punctuation only';
  if (name.length > maxBytes) return `At most ${maxBytes} characters (${name.length})`;
  return null;
}

// ── Versions ───────────────────────────────────

/** Firmware from ArtPollReply VersInfo (`major << 8 | minor`) as `major.minor`. */
export function formatVersInfo(firmware: number): string {
  return `${(firmware >> 8) & 0xff}.${firmware & 0xff}`;
}

// ── Errors ─────────────────────────────────────

/** Messages of node command errors that RDM messages do not cover (bridge contract §8). */
const NODE_COMMAND_MESSAGES: Readonly<Record<string, string>> = {
  timeout: 'The node did not answer',
  unknownNode: 'The node is offline',
  unknownPort: 'The node has no such port',
  invalidPortAddress: 'The node refused the Port-Address: ports of one BindIndex share Net and Sub-Net',
};

/** English message of a failed ArtAddress / ArtIpProg / ArtInput / RDM request. */
export function describeNodeError(err: unknown): string {
  if (err instanceof BridgeCommandError) {
    const known = NODE_COMMAND_MESSAGES[err.code];
    if (known) return known;
    if (err.code === 'badRequest') return err.message || 'The bridge rejected the request';
  }
  return describeRdmError(err);
}
