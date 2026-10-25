/**
 * Add / Add all (plan M6.3, D9, D12, D16): discovered devices become
 * fixtures with the device's CURRENT address and personality → mode,
 * placed like the add dialog (centre + cascade, selected), each with its
 * RDM link — all in ONE undo step (`addFixtures` + `setExtensionData` in a
 * `batch`). Overlaps are allowed; the device list flags them.
 */
import type { AddFixtureItem, Command, FixtureId } from '@pixelmapper/extension-api';
import type { RdmDeviceDescription, RdmUid } from '../bridge/protocol-model';
import type { DeviceEntry } from './device-store';
import type { DeviceRuntime } from './device-runtime';
import { NoDmxFootprintError, type DeviceMatch } from './fixture-matching';
import { absoluteAddress, LINK_KEY, linkJson } from './link';
import { portUniverse } from './node-ports';

/** What happened to one device. */
export interface AddDeviceOutcome {
  uid: RdmUid;
  /** Id of the new fixture; absent when the device was not added. */
  fixtureId?: FixtureId;
  /** Why it was not added (user-facing). */
  error?: string;
  /** Matching warnings, e.g. a mode whose channel count differs from the footprint. */
  warnings: string[];
}

/** A device ready to add. */
interface Prepared {
  device: DeviceEntry;
  description: RdmDeviceDescription;
  universe: number;
  match: DeviceMatch;
}

/** The device with a description of its current personality (re-described when stale). */
async function freshDescription(runtime: DeviceRuntime, device: DeviceEntry): Promise<RdmDeviceDescription | null> {
  const current = device.description;
  if (current && (!device.info || device.info.currentPersonality === current.deviceInfo.currentPersonality)) {
    return device.info ? { ...current, deviceInfo: device.info } : current;
  }
  return runtime.store.describe(device.uid, true);
}

/** Matches one device, or the reason it cannot be added. */
async function prepare(runtime: DeviceRuntime, uid: RdmUid, linked: ReadonlySet<RdmUid>): Promise<Prepared | string> {
  if (linked.has(uid)) return 'Already in the project';
  const device = runtime.store.get(uid);
  if (!device?.present) return 'The device is offline';
  const universe = portUniverse(device.nodeId, device.port);
  if (universe === null) return 'The node port has no universe';
  const description = await freshDescription(runtime, device);
  if (!description) return runtime.store.get(uid)?.error ?? 'The device could not be read';
  try {
    const match = await runtime.matcher.match(description);
    runtime.rememberMatch(match);
    return { device, description, universe, match };
  }
  catch (err) {
    return err instanceof NoDmxFootprintError ? 'The device uses no DMX channels' : ((err as Error).message ?? String(err));
  }
}

/** Fixture name of a device: its label, else its model, else the definition name. */
function deviceName(p: Prepared): string {
  return p.description.deviceLabel?.trim() || p.description.deviceModelDescription?.trim() || p.match.name;
}

/**
 * Adds the devices as fixtures + links in one undo step. Devices that
 * cannot be added (already linked, offline, no footprint, …) are reported
 * per UID; the rest is still added.
 */
export async function addDevices(runtime: DeviceRuntime, uids: readonly RdmUid[]): Promise<AddDeviceOutcome[]> {
  const linked = new Set(runtime.linkedFixtures().map(f => f.link.uid));
  const results = await Promise.all(uids.map(uid => prepare(runtime, uid, linked)));
  const outcomes: AddDeviceOutcome[] = uids.map((uid, i) => {
    const r = results[i]!;
    return typeof r === 'string' ? { uid, error: r, warnings: [] } : { uid, warnings: [...r.match.warnings] };
  });
  const ready = results.filter((r): r is Prepared => typeof r !== 'string');
  if (!ready.length) return outcomes;

  const items: AddFixtureItem[] = ready.map(p => ({
    definition: p.match.key,
    modeIndex: p.match.modeIndex,
    startAddress: absoluteAddress(p.universe, p.description.deviceInfo.dmxStartAddress),
    name: deviceName(p),
  }));
  const { commands } = runtime.api;
  try {
    const add = await commands.addFixtures(items);
    const links: Command[] = add.fixtureIds.map((id, i) => {
      const { device } = ready[i]!;
      return commands.setExtensionData({
        owner: 'fixture',
        ownerId: id,
        key: LINK_KEY,
        value: linkJson({ uid: device.uid, nodeId: device.nodeId, port: device.port, portAddress: device.portAddress, state: 'linked' }),
      });
    });
    const label = ready.length === 1 ? `Add ${items[0]!.name}` : `Add ${ready.length} devices`;
    runtime.api.run(commands.batch([add, ...links], label));
    add.fixtureIds.forEach((id, i) => {
      const outcome = outcomes.find(o => o.uid === ready[i]!.device.uid)!;
      outcome.fixtureId = id;
    });
  }
  catch (err) {
    const message = (err as Error).message ?? String(err);
    for (const p of ready) outcomes.find(o => o.uid === p.device.uid)!.error = message;
  }
  return outcomes;
}
