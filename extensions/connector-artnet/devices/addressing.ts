/**
 * Addressing of devices (plan M6.4, D12):
 *
 * - **Assign free address** — the first gap of the device's footprint in
 *   its port's universe (`findFreeAddressSpan`, every project fixture and
 *   every other device counts as occupied) → RDM SET DMX_START_ADDRESS →
 *   on the device's ACK a linked fixture follows (one undo step).
 * - **Auto-address** — all linked devices of a node, per port universe in
 *   canvas order (top-to-bottom rows, left-to-right), packed gap-free from
 *   the first free address; RDM SETs first, then ONE batch moves the
 *   fixtures of the devices that acknowledged. Failures are per device.
 *
 * Fixture moves run as this extension, so the patch sync does not send
 * them back to the devices.
 */
import { findFreeAddressSpan, getFixture, listFixtures, type Command, type FixtureId } from '@pixelmapper/extension-api';
import type { NodeId, RdmUid } from '../bridge/protocol-model';
import type { DeviceEntry, DeviceStore } from './device-store';
import type { DeviceRuntime } from './device-runtime';
import { addressOccupants, deviceSpanOf, type DeviceSpan } from './conflicts';
import { fixtureLinkState } from './fixture-link-state';
import { absoluteAddress, localAddressOf, universeOf } from './link';
import { portUniverse } from './node-ports';

/** Row tolerance of the canvas order (normalized units). */
const ROW_TOLERANCE = 0.01;

/** Name of a device for lists and messages: label, else model, else UID. */
export function deviceLabel(d: DeviceEntry): string {
  return d.description?.deviceLabel?.trim() || d.description?.deviceModelDescription?.trim() || d.uid;
}

/** Spans of every present device with a known address, footprint and port universe. */
export function presentDeviceSpans(store: DeviceStore): DeviceSpan[] {
  const out: DeviceSpan[] = [];
  for (const d of store.devices.values()) {
    if (!d.present) continue;
    const span = deviceSpanOf(d.uid, deviceLabel(d), portUniverse(d.nodeId, d.port), d.info);
    if (span) out.push(span);
  }
  return out;
}

/** Fixtures effectively linked to `uid` (they follow the device). */
function followingFixtures(runtime: DeviceRuntime, uid: RdmUid): FixtureId[] {
  return runtime.fixturesOfUid(uid).filter((f) => {
    const view = getFixture(f.fixtureId);
    return !!view && !!fixtureLinkState(runtime, view)?.effective;
  }).map(f => f.fixtureId);
}

/**
 * Assign free address: SETs the device to the first free address of its
 * footprint in its port's universe; a linked fixture follows the device's
 * answer. Returns the new local address. Throws a user-facing Error.
 */
export async function assignFreeAddress(runtime: DeviceRuntime, uid: RdmUid): Promise<number> {
  const device = runtime.store.get(uid);
  if (!device?.present || !device.info) throw new Error('The device is offline');
  const universe = portUniverse(device.nodeId, device.port);
  if (universe === null) throw new Error('The node port has no universe');
  const footprint = device.info.dmxFootprint;
  if (footprint < 1) throw new Error('The device uses no DMX channels');
  const following = followingFixtures(runtime, uid);
  const occupants = addressOccupants(listFixtures(), presentDeviceSpans(runtime.store), { fixtureIds: following, uids: [uid] });
  const start = findFreeAddressSpan(occupants, footprint, 1, { universe });
  if (start === null) throw new Error(`No free address for ${footprint} channels in U${universe}`);

  const info = await runtime.store.setStartAddress(uid, localAddressOf(start));
  // The fixture follows what the device reports (D5), falling back to the ACKed value.
  const address = absoluteAddress(universe, info?.dmxStartAddress ?? localAddressOf(start));
  const { commands } = runtime.api;
  const moves: Command[] = following
    .filter(id => getFixture(id)?.startAddress !== address)
    .map(fixtureId => commands.setStartAddress({ fixtureId, startAddress: address }));
  if (moves.length) runtime.api.run(moves.length === 1 ? moves[0]! : commands.batch(moves, 'Assign free address'));
  return localAddressOf(address);
}

/** Result of auto-address for one device. */
export interface AutoAddressOutcome {
  uid: RdmUid;
  fixtureId: FixtureId;
  /** New local address (on success). */
  address?: number;
  error?: string;
}

/** One device to re-address with its fixture. */
interface Target {
  uid: RdmUid;
  fixtureId: FixtureId;
  universe: number;
  footprint: number;
  position: { x: number; y: number };
}

/** Canvas order: rows top to bottom (within a tolerance), then left to right. */
function byCanvasPosition(a: Target, b: Target): number {
  if (Math.abs(a.position.y - b.position.y) > ROW_TOLERANCE) return a.position.y - b.position.y;
  return a.position.x - b.position.x;
}

/**
 * Auto-address all effectively linked devices of `nodeId` gap-free per port
 * universe in canvas order; one undo step for the fixtures of the devices
 * that acknowledged their new address.
 */
export async function autoAddress(runtime: DeviceRuntime, nodeId: NodeId): Promise<AutoAddressOutcome[]> {
  const targets: Target[] = [];
  const outcomes: AutoAddressOutcome[] = [];
  for (const f of runtime.linkedFixtures()) {
    if (f.link.nodeId !== nodeId) continue;
    const view = getFixture(f.fixtureId);
    const state = view ? fixtureLinkState(runtime, view) : null;
    if (!view || !state?.effective || state.portUniverse === null) continue;
    const device = state.device;
    if (!device?.present || !device.info) {
      outcomes.push({ uid: f.link.uid, fixtureId: f.fixtureId, error: 'The device is offline' });
      continue;
    }
    targets.push({ uid: f.link.uid, fixtureId: f.fixtureId, universe: state.portUniverse, footprint: Math.max(1, device.info.dmxFootprint), position: { ...view.position } });
  }

  // Plan addresses: everything except the targets stays occupied.
  const occupants = addressOccupants(listFixtures(), presentDeviceSpans(runtime.store), {
    fixtureIds: targets.map(t => t.fixtureId),
    uids: targets.map(t => t.uid),
  });
  const planned: { target: Target; local: number }[] = [];
  for (const target of [...targets].sort((a, b) => a.universe - b.universe || byCanvasPosition(a, b))) {
    const start = findFreeAddressSpan(occupants, target.footprint, 1, { universe: target.universe });
    if (start === null) {
      outcomes.push({ uid: target.uid, fixtureId: target.fixtureId, error: `No room left in U${target.universe}` });
      continue;
    }
    occupants.push({ id: `auto:${target.uid}`, startAddress: start, channelCount: target.footprint });
    planned.push({ target, local: localAddressOf(start) });
  }

  // RDM first; the fixtures of the devices that acknowledged follow in one step.
  const results = await Promise.all(planned.map(async ({ target, local }) => {
    try {
      const info = await runtime.store.setStartAddress(target.uid, local);
      return { target, address: info?.dmxStartAddress ?? local };
    }
    catch (err) {
      return { target, error: (err as Error).message ?? String(err) };
    }
  }));
  const { commands } = runtime.api;
  const moves: Command[] = [];
  for (const r of results) {
    outcomes.push({ uid: r.target.uid, fixtureId: r.target.fixtureId, address: r.address, error: r.error });
    if (r.address === undefined) continue;
    const startAddress = absoluteAddress(r.target.universe, r.address);
    const view = getFixture(r.target.fixtureId);
    if (view && view.startAddress !== startAddress && universeOf(startAddress) === r.target.universe) {
      moves.push(commands.setStartAddress({ fixtureId: r.target.fixtureId, startAddress }));
    }
  }
  if (moves.length) runtime.api.run(commands.batch(moves, 'Auto-address devices'));
  return outcomes;
}
