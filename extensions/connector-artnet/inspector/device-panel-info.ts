/**
 * Pure display helpers of the RDM device panel (`RdmDevicePanel.vue`, used
 * by the inspector's RDM section and the device dialog): firmware text,
 * node port text, personality choices, address range and whether a device
 * can be added to the canvas. Reactive when called inside a `computed`
 * (reads the node connectors through `node-ports`).
 */
import type { FixtureId, SelectOption } from '@pixelmapper/extension-api';
import type { RdmDeviceDescription, RdmDeviceInfo } from '../bridge/protocol-model';
import type { DeviceEntry } from '../devices/device-store';
import { deviceLabel } from '../devices/addressing';
import { deviceSpanOf } from '../devices/conflicts';
import { UNIVERSE_SIZE } from '../devices/link';
import { nodeDisplayName, portDisplayName, portUniverse } from '../devices/node-ports';
import { readingFromDevice } from '../firmware/device-store-reader';
import { formatFirmwareVersion, isFirmwareVersionId } from '../firmware/firmware-version';

/** SOFTWARE_VERSION_LABEL of the running firmware, else its version id; null while unknown. */
export function firmwareText(d: DeviceEntry | undefined): string | null {
  if (!d?.info) return d?.description?.softwareVersionLabel ?? null;
  const reading = readingFromDevice(d.info, d.description);
  if (reading.state !== 'ok') return null;
  if (reading.softwareVersionLabel) return reading.softwareVersionLabel;
  return isFirmwareVersionId(d.info.softwareVersionId) ? formatFirmwareVersion(d.info.softwareVersionId) : `0x${d.info.softwareVersionId.toString(16)}`;
}

/** Node port name and, when mapped, its universe (“PM Node port 1 · U1”). */
export function portText(portName: string, universe: number | null): string {
  return universe !== null ? `${portName} · U${universe}` : portName;
}

/** Node port of a device as it was last listed (for devices without a fixture). */
export function devicePortText(d: DeviceEntry): string {
  const name = `${nodeDisplayName(d.nodeId)} ${portDisplayName(d.nodeId, d.port).toLowerCase()}`;
  return portText(name, portUniverse(d.nodeId, d.port));
}

/** `2 · RGB (3 ch)`; the parenthesis is left out when the description already is the footprint. */
export function personalityLabel(index: number, description: RdmDeviceDescription | null): string {
  const p = description?.personalities.find(x => x.index === index);
  if (!p) return String(index);
  const channels = `${p.footprint} ch`;
  const name = p.description?.trim();
  return name && name !== channels ? `${index} · ${name} (${channels})` : `${index} · ${channels}`;
}

/** Choices of the personality select: 1…personalityCount (values are the 1-based index as string). */
export function personalityOptions(info: RdmDeviceInfo, description: RdmDeviceDescription | null): SelectOption[] {
  const out: SelectOption[] = [];
  for (let i = 1; i <= info.personalityCount; i++) out.push({ value: String(i), label: personalityLabel(i, description) });
  return out;
}

/** Highest local start address a footprint fits at (1…512 − footprint + 1). */
export function maxStartAddress(footprint: number): number {
  return UNIVERSE_SIZE - Math.max(1, footprint) + 1;
}

/** True when the device reports a usable start address (65535 = none). */
export function hasStartAddress(info: RdmDeviceInfo | null): info is RdmDeviceInfo {
  return !!info && info.dmxStartAddress >= 1 && info.dmxStartAddress <= UNIVERSE_SIZE;
}

/** A present device without fixture whose address, footprint and port universe are known (same rule as the device list). */
export function canAddDevice(d: DeviceEntry | undefined, fixtureId: FixtureId | null): boolean {
  if (!d?.present || fixtureId !== null) return false;
  return !!deviceSpanOf(d.uid, deviceLabel(d), portUniverse(d.nodeId, d.port), d.info);
}
