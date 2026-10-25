/**
 * Simulated RDM devices behind a `FakeArtNetBackend` (tests of the device
 * features): XBAR500-like tubes on node ports answering `rdmDescribe`,
 * DEVICE_INFO, DMX_START_ADDRESS / DMX_PERSONALITY / IDENTIFY_DEVICE SETs,
 * `todControl` flush, unplugging and changes "from the node's panel".
 */
import { BridgeCommandError } from '../../bridge/backend';
import type { FakeArtNetBackend } from '../../bridge/testing/fake-backend';
import { makeDescription, makeDeviceInfo, makeNode, makeTod, TUBE_FOOTPRINTS } from '../../bridge/testing/fixtures';
import type { NodeState, RdmDeviceInfo, RdmUid } from '../../bridge/protocol-model';
import { RDM_PID } from '../../bridge/rdm-constants';

/** One simulated device. */
export interface FakeDevice {
  uid: RdmUid;
  /** BindIndex of the node port it hangs on. */
  bind: number;
  info: RdmDeviceInfo;
  label: string | null;
  identify: boolean;
  /** Error code of every request (e.g. 'timeout'), null = answers. */
  failWith: 'timeout' | 'nack' | null;
}

export class FakeRdmDevices {
  readonly devices = new Map<RdmUid, FakeDevice>();
  /** RDM SETs received, in order. */
  readonly sets: { uid: RdmUid; pid: number; value: unknown }[] = [];

  constructor(
    private readonly backend: FakeArtNetBackend,
    readonly node: NodeState = makeNode(),
  ) {
    backend.handle('rdmDescribe', (args) => {
      const d = this.answer(args.uid);
      return makeDescription(d.uid, { deviceLabel: d.label }, d.info);
    });
    backend.handle('rdmGet', (args) => {
      const d = this.answer(args.uid);
      if (args.pid === RDM_PID.DEVICE_INFO) return { data: '', value: { ...d.info } };
      if (args.pid === RDM_PID.DMX_START_ADDRESS) return { data: '', value: d.info.dmxStartAddress };
      throw new BridgeCommandError('nack', 'NACK UNKNOWN_PID', { nackReason: 0, nackName: 'UNKNOWN_PID' });
    });
    backend.handle('rdmSet', (args) => {
      const d = this.answer(args.uid);
      const value = 'value' in args ? args.value : undefined;
      this.sets.push({ uid: d.uid, pid: args.pid, value });
      if (args.pid === RDM_PID.DMX_START_ADDRESS) {
        if (typeof value !== 'number' || value < 1 || value > 512) throw new BridgeCommandError('nack', 'NACK DATA_OUT_OF_RANGE', { nackReason: 6, nackName: 'DATA_OUT_OF_RANGE' });
        d.info = { ...d.info, dmxStartAddress: value };
      }
      else if (args.pid === RDM_PID.DMX_PERSONALITY) {
        const p = value as number;
        if (!(p >= 1 && p <= d.info.personalityCount)) throw new BridgeCommandError('nack', 'NACK DATA_OUT_OF_RANGE', { nackReason: 6, nackName: 'DATA_OUT_OF_RANGE' });
        d.info = { ...d.info, currentPersonality: p, dmxFootprint: TUBE_FOOTPRINTS[p - 1] ?? d.info.dmxFootprint };
      }
      else if (args.pid === RDM_PID.IDENTIFY_DEVICE) d.identify = value === true;
      return { data: '' };
    });
    backend.handle('todControl', (args) => {
      if (args.action === 'flush') this.emitTod(args.port.bind);
      return {};
    });
  }

  /** Adds a tube on port `bind` (personality 1 = 12 ch unless overridden). */
  add(uid: RdmUid, bind: number, info: Partial<RdmDeviceInfo> = {}, label: string | null = null): FakeDevice {
    const device: FakeDevice = { uid, bind, info: makeDeviceInfo(info), label, identify: false, failWith: null };
    this.devices.set(uid, device);
    return device;
  }

  /** Announces the node and the TOD of every port (as the bridge would on discovery). */
  announce(): void {
    this.backend.emit({ type: 'node', node: this.node });
    for (const port of this.node.ports) this.emitTod(port.port.bind);
  }

  /** Emits the current TOD of port `bind`. */
  emitTod(bind: number): void {
    const uids = [...this.devices.values()].filter(d => d.bind === bind).map(d => d.uid);
    this.backend.emit({ type: 'tod', ...makeTod(this.node.nodeId, bind, uids, bind) });
  }

  /** Removes a device from its line (the next TOD drops it). */
  unplug(uid: RdmUid): void {
    const d = this.devices.get(uid);
    if (!d) return;
    this.devices.delete(uid);
    this.emitTod(d.bind);
  }

  /** Changes a device "at the node's panel": no TOD change, only a LOCAL_RDM_SET queued message. */
  changeFromPanel(uid: RdmUid, patch: Partial<RdmDeviceInfo>): void {
    const d = this.devices.get(uid)!;
    d.info = { ...d.info, ...patch };
    // LOCAL_RDM_SET response: sequence u16, port u8, UID 6 B, sub-device u16, PID u16.
    const data = `0001${d.bind.toString(16).padStart(2, '0')}${uid.replace(':', '').toLowerCase()}000000f0`;
    this.backend.emit({ type: 'rdmQueued', nodeId: this.node.nodeId, port: { bind: d.bind, index: 0 }, uid: this.node.uid!, subDevice: 0, pid: 0x8150, data });
  }

  /** The device if it answers, else the error the bridge would report. */
  private answer(uid: RdmUid): FakeDevice {
    const d = this.devices.get(uid);
    if (!d || d.failWith === 'timeout') throw new BridgeCommandError('timeout', 'No response from the device');
    if (d.failWith === 'nack') throw new BridgeCommandError('nack', 'NACK HARDWARE_FAULT', { nackReason: 2, nackName: 'HARDWARE_FAULT' });
    return d;
  }
}
