/**
 * Address conflicts of discovered devices (plan M6.4, D12).
 *
 * A device occupies `dmxFootprint` channels from its DMX start address in
 * the universe of its node port (DEVICE_INFO — a matched mode's channel
 * count can differ from the footprint). It conflicts with every project
 * fixture (unlinked ones count as occupied) and every other present device
 * whose channels overlap — except the fixture linked to it.
 */
import type { AddressOccupant, FixtureId, FixtureSummary, Json } from '@pixelmapper/extension-api';
import type { RdmDeviceInfo, RdmUid } from '../bridge/protocol-model';
import { absoluteAddress, localAddressOf, readLink, universeOf } from './link';

/** Channels of one device in the absolute address space. */
export interface DeviceSpan {
  uid: RdmUid;
  /** Name for messages (label, model or UID). */
  label: string;
  /** Absolute 1-based start address. */
  startAddress: number;
  /** DMX footprint. */
  channelCount: number;
}

/** The span of a device, or null without universe, address or footprint. */
export function deviceSpanOf(uid: RdmUid, label: string, universe: number | null, info: RdmDeviceInfo | null): DeviceSpan | null {
  if (universe === null || !info || info.dmxFootprint < 1 || info.dmxStartAddress < 1 || info.dmxStartAddress > 512) return null;
  return { uid, label, startAddress: absoluteAddress(universe, info.dmxStartAddress), channelCount: info.dmxFootprint };
}

/** True when two address ranges share a channel. */
export function overlaps(a: { startAddress: number; channelCount: number }, b: { startAddress: number; channelCount: number }): boolean {
  return a.startAddress < b.startAddress + b.channelCount && b.startAddress < a.startAddress + a.channelCount;
}

/** UID a project fixture is linked to (any link state), else null. */
function linkedUid(f: Readonly<FixtureSummary>): RdmUid | null {
  return readLink(f.extensionData as Record<string, Record<string, Json>> | undefined)?.uid ?? null;
}

/** `U1.13` for an absolute start address. */
export function formatAddress(startAddress: number): string {
  return `U${universeOf(startAddress)}.${localAddressOf(startAddress)}`;
}

/**
 * What overlaps `span`, as names with addresses (`Tube 3 (U1.13)`,
 * `device XBAR500 (U1.10)`): project fixtures (except the ones linked to
 * the device) and other device spans. Sorted, without duplicates.
 */
export function conflictsOf(span: DeviceSpan, fixtures: readonly Readonly<FixtureSummary>[], devices: readonly DeviceSpan[]): string[] {
  const names = new Set<string>();
  for (const f of fixtures) {
    if (f.channelCount < 1 || linkedUid(f) === span.uid) continue;
    if (overlaps(span, f)) names.add(`${f.name || `Fixture ${f.id}`} (${formatAddress(f.startAddress)})`);
  }
  for (const d of devices) {
    if (d.uid !== span.uid && overlaps(span, d)) names.add(`device ${d.label} (${formatAddress(d.startAddress)})`);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Occupants for `findFreeAddressSpan`: the project fixtures plus the device
 * spans (ids `device:<uid>`), minus the fixtures/devices in `ignore`
 * (fixture ids or UIDs being re-addressed).
 */
export function addressOccupants(fixtures: readonly Readonly<FixtureSummary>[], devices: readonly DeviceSpan[], ignore: { fixtureIds?: Iterable<FixtureId>; uids?: Iterable<RdmUid> } = {}): AddressOccupant[] {
  const skipFixtures = new Set(ignore.fixtureIds ?? []);
  const skipUids = new Set(ignore.uids ?? []);
  const out: AddressOccupant[] = [];
  for (const f of fixtures) {
    const uid = linkedUid(f);
    if (skipFixtures.has(f.id) || (uid !== null && skipUids.has(uid))) continue;
    out.push({ id: f.id, startAddress: f.startAddress, channelCount: f.channelCount });
  }
  for (const d of devices) {
    if (!skipUids.has(d.uid)) out.push({ id: `device:${d.uid}`, startAddress: d.startAddress, channelCount: d.channelCount });
  }
  return out;
}
