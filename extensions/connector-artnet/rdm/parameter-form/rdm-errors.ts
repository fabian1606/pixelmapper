/**
 * English messages for failed RDM requests: NACK reasons (E1.20 Table A-17,
 * E1.37-2) and the bridge/client error codes (bridge contract §8).
 */
import { BridgeCommandError } from '../../bridge/backend';
import { RDM_NACK_REASON } from '../../bridge/rdm-constants';
import { RdmValueError } from './wire-bytes';

/** What a NACK reason means for the user, by reason code. */
export const NACK_MESSAGES: Readonly<Record<number, string>> = {
  0x0000: 'The device does not support this parameter',
  0x0001: 'The device rejected the data format',
  0x0002: 'The device reports a hardware fault',
  0x0003: 'A proxy rejected the request',
  0x0004: 'The parameter is write-protected (device locked)',
  0x0005: 'The device does not allow this operation on this parameter',
  0x0006: 'The value is out of the device\'s range',
  0x0007: 'The device is busy — try again',
  0x0008: 'The request is too large for the device',
  0x0009: 'The sub-device does not exist',
  0x000a: 'A proxy is busy — try again',
  0x000b: 'The device cannot do this right now',
};

/** Messages of the other error codes. */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  timeout: 'No answer from the device',
  badResponse: 'The device sent a malformed answer',
  unknownNode: 'The node is offline',
  unknownPort: 'The node has no such port',
  udpUnavailable: 'The bridge cannot use the network (UDP port not bound)',
  notConnected: 'The Art-Net bridge is not connected',
  disconnected: 'The connection to the Art-Net bridge was lost',
  requestTimeout: 'The Art-Net bridge did not answer in time',
};

/** Message of a NACK: `<meaning> (NACK <NAME>)`. */
export function describeNack(reason: number | undefined, name?: unknown): string {
  const known = reason !== undefined ? RDM_NACK_REASON[reason] : undefined;
  const label = known ?? (typeof name === 'string' && name ? name : reason !== undefined ? `0x${reason.toString(16).padStart(4, '0')}` : 'unknown reason');
  const meaning = reason !== undefined ? NACK_MESSAGES[reason] : undefined;
  return `${meaning ?? 'The device refused the request'} (NACK ${label})`;
}

/** English message of anything an RDM request can reject with. */
export function describeRdmError(err: unknown): string {
  if (err instanceof BridgeCommandError) {
    if (err.code === 'nack') return describeNack(err.nackReason, err.details.nackName);
    return CODE_MESSAGES[err.code] ?? (err.message || err.code);
  }
  if (err instanceof RdmValueError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
