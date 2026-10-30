/**
 * Small RDM helpers of the device features: a per-port concurrency limit,
 * decoding DEVICE_INFO values and LOCAL_RDM_SET queued messages, and
 * user-facing error texts.
 */
import { BridgeCommandError } from '../bridge/backend';
import type { RdmDeviceInfo, RdmUid } from '../bridge/protocol-model';

/**
 * LOCAL_RDM_SET (0x8150) of the Pixelmapper Node, from
 * `pixelmapper-hardware/protocol/pids.toml`: the node queues this GET
 * response after a SET from its own panel to an attached device (node
 * contract §7), so Pixelmapper re-reads that device.
 */
export const PID_LOCAL_RDM_SET = 0x8150;

/** Runs async jobs with at most `max` in flight (FIFO). */
export class Limiter {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  /** Runs `job` when a slot is free. */
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.running++;
    try {
      return await job();
    }
    finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

/** The DEVICE_INFO value of an `rdmGet` result, or null when malformed. */
export function asDeviceInfo(value: unknown): RdmDeviceInfo | null {
  const v = value as Partial<RdmDeviceInfo> | null;
  if (!v || typeof v !== 'object') return null;
  const fields: (keyof RdmDeviceInfo)[] = ['deviceModelId', 'dmxFootprint', 'currentPersonality', 'personalityCount', 'dmxStartAddress', 'softwareVersionId'];
  return fields.every(f => typeof v[f] === 'number') ? v as RdmDeviceInfo : null;
}

/**
 * Target UID of a LOCAL_RDM_SET response (hex): sequence u16, port u8,
 * UID 6 bytes, sub-device u16, PID u16 (big-endian, 13 bytes). Null when
 * malformed.
 */
export function localRdmSetUid(dataHex: string): RdmUid | null {
  if (!/^[0-9a-f]{26}$/i.test(dataHex)) return null;
  const uid = dataHex.slice(6, 18).toUpperCase();
  return `${uid.slice(0, 4)}:${uid.slice(4)}`;
}

/** User-facing text of a failed RDM request. */
export function rdmErrorText(err: unknown): string {
  if (err instanceof BridgeCommandError) {
    if (err.code === 'timeout') return 'The device does not answer';
    if (err.code === 'nack') return `The device refused (${String(err.details.nackName ?? err.message)})`;
    if (err.code === 'notConnected' || err.code === 'disconnected') return 'The Art-Net bridge is not connected';
    return err.message;
  }
  return (err as Error)?.message ?? String(err);
}

/** True when the error means the device did not answer at all. */
export function isNoAnswer(err: unknown): boolean {
  return err instanceof BridgeCommandError && err.code === 'timeout';
}
