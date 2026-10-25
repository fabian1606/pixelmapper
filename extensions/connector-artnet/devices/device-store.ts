/**
 * RDM devices on the ports of the configured nodes (plan M6.1, D5).
 *
 * Built only from what the network says (last-writer-wins): the TODs of the
 * node directory say which UIDs are on which port; `rdmDescribe` reads each
 * new device once; DEVICE_INFO is re-read every 30–60 s, whenever a port's
 * TOD changes, after every SET and when the node reports a SET from its
 * panel (LOCAL_RDM_SET queued message). Nothing here is derived from what
 * Pixelmapper sent. One shared instance per app (`device-runtime.ts`).
 *
 * While a device's firmware is written (plan M7.4) its reads are held
 * (`holdReads`): the tube runs its bootloader, and GETs would only time out
 * and compete with the update for the port.
 */
import { shallowReactive, watch, type WatchStopHandle } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { NodeId, PortRef, RdmDeviceDescription, RdmDeviceInfo, RdmUid, Tod } from '../bridge/protocol-model';
import { portKey, samePort } from '../bridge/protocol-model';
import { RDM_PID } from '../bridge/rdm-constants';
import { asDeviceInfo, isNoAnswer, Limiter, localRdmSetUid, PID_LOCAL_RDM_SET, rdmErrorText } from './rdm-io';

/** Default interval of the DEVICE_INFO re-read (contract §7: 30–60 s). */
export const DEVICE_REREAD_MS = 45_000;

/** RDM requests in flight per node port (the bridge queues the rest). */
const PER_PORT_CONCURRENCY = 2;

/** Longest DEVICE_LABEL (E1.20 §10.5.4: up to 32 characters). */
export const DEVICE_LABEL_MAX = 32;

/** One device as last reported by the network. */
export interface DeviceEntry {
  uid: RdmUid;
  nodeId: NodeId;
  port: PortRef;
  /** Port-Address of the TOD that listed the device. */
  portAddress: number;
  /** Listed in the latest TOD of its port (and the node answers). */
  present: boolean;
  /** Full description (`rdmDescribe`), null until read. */
  description: RdmDeviceDescription | null;
  /** Latest DEVICE_INFO answer (start address, personality, footprint), null until read. */
  info: RdmDeviceInfo | null;
  /** Time of the last answer (ms since epoch), null when never answered. */
  lastSeen: number | null;
  /** The last request got no answer (listed in the TOD but silent). */
  noAnswer: boolean;
  /** Last read/write failure (user-facing), null after a success. */
  error: string | null;
  /** A describe is in flight. */
  loading: boolean;
  /** IDENTIFY_DEVICE is on (as acknowledged by the device). */
  identifying: boolean;
}

/** Dependencies of the store (injectable for tests). */
export interface DeviceStoreOptions {
  backend: ArtNetBackend;
  directory: NodeDirectory;
  /** Nodes whose devices are tracked (reactive getter): the nodes with a connector. */
  nodeIds: () => Iterable<NodeId>;
  /** Re-read interval of DEVICE_INFO (default 45 s). */
  rereadMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

/** Map key of a node port. */
function portId(nodeId: NodeId, port: PortRef): string {
  return `${nodeId}|${portKey(port)}`;
}

export class DeviceStore {
  /** Devices by UID (reactive; entries are replaced on every change). */
  readonly devices: Map<RdmUid, DeviceEntry> = shallowReactive(new Map());

  private readonly backend: ArtNetBackend;
  private readonly directory: NodeDirectory;
  private readonly nodeIds: () => Iterable<NodeId>;
  private readonly rereadMs: number;
  private readonly now: () => number;
  /** UIDs of every tracked TOD as last processed. */
  private lastTods = new Map<string, string>();
  private limiters = new Map<string, Limiter>();
  private stopWatch: WatchStopHandle | null = null;
  private offEvents: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Holders per UID whose reads are paused (see `holdReads`); reactive. */
  private readonly holds: Map<RdmUid, number> = shallowReactive(new Map());

  constructor(options: DeviceStoreOptions) {
    this.backend = options.backend;
    this.directory = options.directory;
    this.nodeIds = options.nodeIds;
    this.rereadMs = options.rereadMs ?? DEVICE_REREAD_MS;
    this.now = options.now ?? (() => Date.now());
  }

  // ── Lifecycle ────────────────────────────────

  /** Follows the TODs, re-reads periodically and listens for panel SETs (idempotent). */
  start(): void {
    if (this.stopWatch) return;
    this.stopWatch = watch(
      () => ({ tods: [...this.directory.tods.values()], nodes: new Set(this.nodeIds()) }),
      ({ tods, nodes }) => this.onTods(tods, nodes),
      { immediate: true },
    );
    this.offEvents.push(this.backend.on('rdmQueued', (e) => {
      // A SET from the node's panel (LOCAL_RDM_SET) or a queued change of the device itself.
      const uid = e.pid === PID_LOCAL_RDM_SET ? localRdmSetUid(e.data) : e.uid;
      if (uid && this.devices.has(uid)) void this.readInfo(uid);
    }));
    this.timer = setInterval(() => this.rereadAll(), this.rereadMs);
  }

  /** Stops following (entries stay, marked not present). */
  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    for (const off of this.offEvents) off();
    this.offEvents = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastTods.clear();
    for (const d of this.devices.values()) if (d.present) this.patch(d.uid, { present: false });
  }

  // ── Queries ──────────────────────────────────

  /** A device by UID. */
  get(uid: RdmUid): DeviceEntry | undefined {
    return this.devices.get(uid);
  }

  /** Devices of a node, by port then DMX start address then UID. */
  devicesOf(nodeId: NodeId): DeviceEntry[] {
    return [...this.devices.values()]
      .filter(d => d.nodeId === nodeId)
      .sort((a, b) => a.port.bind - b.port.bind || a.port.index - b.port.index
        || (a.info?.dmxStartAddress ?? 0xffff) - (b.info?.dmxStartAddress ?? 0xffff) || a.uid.localeCompare(b.uid));
  }

  /** True while reads of the device are held (its firmware is being written). */
  isHeld(uid: RdmUid): boolean {
    return (this.holds.get(uid) ?? 0) > 0;
  }

  // ── Read holds ───────────────────────────────

  /**
   * Pauses every read of `uid` (describe, DEVICE_INFO, labels) until the
   * returned release function is called — used while its firmware is
   * written. Reads asked for meanwhile answer with what is known. Releasing
   * twice is a no-op.
   */
  holdReads(uid: RdmUid): () => void {
    this.holds.set(uid, (this.holds.get(uid) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.holds.get(uid) ?? 1) - 1;
      if (left > 0) this.holds.set(uid, left);
      else this.holds.delete(uid);
    };
  }

  // ── Reads ────────────────────────────────────

  /** Reads the full description (`refresh` bypasses the bridge's cache). */
  async describe(uid: RdmUid, refresh = false): Promise<RdmDeviceDescription | null> {
    const d = this.devices.get(uid);
    if (!d) return null;
    if (this.isHeld(uid)) return d.description;
    this.patch(uid, { loading: true });
    try {
      const description = await this.limited(d, () => this.backend.request('rdmDescribe', { nodeId: d.nodeId, port: d.port, uid, ...(refresh ? { refresh } : {}) }));
      this.patch(uid, { description, info: description.deviceInfo, lastSeen: this.now(), noAnswer: false, error: null, loading: false });
      return description;
    }
    catch (err) {
      this.patch(uid, { loading: false, error: rdmErrorText(err), noAnswer: isNoAnswer(err) });
      return null;
    }
  }

  /** Re-reads DEVICE_INFO (the device's answer is the state, D5). */
  async readInfo(uid: RdmUid): Promise<RdmDeviceInfo | null> {
    const d = this.devices.get(uid);
    if (!d) return null;
    if (this.isHeld(uid)) return d.info;
    try {
      const result = await this.limited(d, () => this.backend.request('rdmGet', { nodeId: d.nodeId, port: d.port, uid, pid: RDM_PID.DEVICE_INFO }));
      const info = asDeviceInfo(result.value);
      if (!info) throw new Error('Malformed DEVICE_INFO');
      this.patch(uid, { info, lastSeen: this.now(), noAnswer: false, error: null });
      // Another personality: slots and footprint of the description are stale.
      const described = this.devices.get(uid)?.description;
      if (described && described.deviceInfo.currentPersonality !== info.currentPersonality) void this.describe(uid);
      return info;
    }
    catch (err) {
      this.patch(uid, { error: rdmErrorText(err), noAnswer: isNoAnswer(err) });
      return null;
    }
  }

  /**
   * Reads DEVICE_LABEL into the description (null when the device has no
   * description yet, holds reads, or the GET fails — the error is kept).
   */
  async readLabel(uid: RdmUid): Promise<string | null> {
    const d = this.devices.get(uid);
    if (!d?.description || this.isHeld(uid)) return d?.description?.deviceLabel ?? null;
    try {
      const result = await this.limited(d, () => this.backend.request('rdmGet', { nodeId: d.nodeId, port: d.port, uid, pid: RDM_PID.DEVICE_LABEL }));
      const label = typeof result.value === 'string' ? result.value : null;
      const now = this.devices.get(uid);
      if (now?.description) this.patch(uid, { description: { ...now.description, deviceLabel: label }, lastSeen: this.now(), noAnswer: false, error: null });
      return label;
    }
    catch (err) {
      this.patch(uid, { error: rdmErrorText(err), noAnswer: isNoAnswer(err) });
      return null;
    }
  }

  // ── Writes (state still comes from the re-read) ──

  /** SET DMX_START_ADDRESS (1–512), then re-read. Throws a user-facing Error on failure. */
  async setStartAddress(uid: RdmUid, localAddress: number): Promise<RdmDeviceInfo | null> {
    await this.set(uid, RDM_PID.DMX_START_ADDRESS, localAddress);
    return this.readInfo(uid);
  }

  /** SET DMX_PERSONALITY (1-based), then re-read. Throws a user-facing Error on failure. */
  async setPersonality(uid: RdmUid, personality: number): Promise<RdmDeviceInfo | null> {
    await this.set(uid, RDM_PID.DMX_PERSONALITY, personality);
    return this.readInfo(uid);
  }

  /**
   * SET DEVICE_LABEL (at most 32 characters), then read it back: the label
   * shown is the device's answer (D5). Throws a user-facing Error on failure.
   */
  async setDeviceLabel(uid: RdmUid, label: string): Promise<string | null> {
    if (label.length > DEVICE_LABEL_MAX) throw new Error(`The label is longer than ${DEVICE_LABEL_MAX} characters`);
    await this.set(uid, RDM_PID.DEVICE_LABEL, label);
    return this.readLabel(uid);
  }

  /** Turns IDENTIFY_DEVICE on/off; `identifying` follows the device's ACK. */
  async identify(uid: RdmUid, on: boolean): Promise<void> {
    await this.set(uid, RDM_PID.IDENTIFY_DEVICE, on);
    this.patch(uid, { identifying: on });
  }

  /** "Rediscover": ArtTodControl AtcFlush on every port of the node that has devices or is an output. */
  async rediscover(nodeId: NodeId, ports: readonly PortRef[]): Promise<void> {
    await Promise.all(ports.map(port => this.backend.request('todControl', { nodeId, port, action: 'flush' })));
  }

  // ── Internals ────────────────────────────────

  /** SET with error bookkeeping. */
  private async set(uid: RdmUid, pid: number, value: number | boolean | string): Promise<void> {
    const d = this.devices.get(uid);
    if (!d) throw new Error('Unknown device');
    try {
      await this.limited(d, () => this.backend.request('rdmSet', { nodeId: d.nodeId, port: d.port, uid, pid, value }));
      this.patch(uid, { lastSeen: this.now(), noAnswer: false, error: null });
    }
    catch (err) {
      const text = rdmErrorText(err);
      this.patch(uid, { error: text, noAnswer: isNoAnswer(err) });
      throw new Error(text);
    }
  }

  /** Runs an RDM request within the port's concurrency limit. */
  private limited<T>(d: DeviceEntry, job: () => Promise<T>): Promise<T> {
    const key = portId(d.nodeId, d.port);
    let limiter = this.limiters.get(key);
    if (!limiter) this.limiters.set(key, limiter = new Limiter(PER_PORT_CONCURRENCY));
    return limiter.run(job);
  }

  /** Replaces an entry with a patched copy (keeps the map reactive). */
  private patch(uid: RdmUid, patch: Partial<DeviceEntry>) {
    const d = this.devices.get(uid);
    if (d) this.devices.set(uid, { ...d, ...patch });
  }

  /** Diffs the tracked TODs with the last ones: new devices are described, gone ones marked absent. */
  private onTods(tods: readonly Tod[], nodes: ReadonlySet<NodeId>) {
    const seen = new Set<string>();
    for (const tod of tods) {
      if (!nodes.has(tod.nodeId)) continue;
      const key = portId(tod.nodeId, tod.port);
      seen.add(key);
      const signature = tod.uids.join(',');
      const changed = this.lastTods.get(key) !== signature;
      this.lastTods.set(key, signature);
      if (!changed) continue;
      const listed = new Set(tod.uids);
      // Devices that left this port.
      for (const d of this.devices.values()) {
        if (d.nodeId === tod.nodeId && samePort(d.port, tod.port) && !listed.has(d.uid) && d.present) this.patch(d.uid, { present: false });
      }
      for (const uid of tod.uids) this.onListed(uid, tod);
    }
    // Ports (or nodes) whose TOD disappeared: node gone, bridge lost, connector removed.
    for (const key of [...this.lastTods.keys()]) {
      if (seen.has(key)) continue;
      this.lastTods.delete(key);
      for (const d of this.devices.values()) if (portId(d.nodeId, d.port) === key && d.present) this.patch(d.uid, { present: false });
    }
  }

  /** A UID listed in a (changed) TOD: new → describe; known → re-read (TOD change, contract §7). */
  private onListed(uid: RdmUid, tod: Tod) {
    const d = this.devices.get(uid);
    const location = { nodeId: tod.nodeId, port: { ...tod.port }, portAddress: tod.portAddress, present: true };
    if (!d) {
      this.devices.set(uid, { uid, ...location, description: null, info: null, lastSeen: null, noAnswer: false, error: null, loading: false, identifying: false });
      void this.describe(uid);
      return;
    }
    const moved = d.nodeId !== tod.nodeId || !samePort(d.port, tod.port);
    this.patch(uid, location);
    if (moved || !d.description) void this.describe(uid);
    else void this.readInfo(uid);
  }

  /** Periodic re-read of every present device. */
  private rereadAll() {
    for (const d of this.devices.values()) {
      if (!d.present || this.isHeld(d.uid)) continue;
      if (d.description) void this.readInfo(d.uid);
      else if (!d.loading) void this.describe(d.uid);
    }
  }
}
