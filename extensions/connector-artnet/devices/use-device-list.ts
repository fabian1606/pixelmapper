/**
 * Rows of the device list of one node (plan M6.1): address · label · model ·
 * personality · firmware · state (new / linked / conflict / offline), with
 * the conflicts and the linked fixture of each device. Reactive: devices
 * from the store, fixtures from `listFixtures()` (model tick), universes
 * from the node connector.
 */
import { computed, type ComputedRef } from 'vue';
import { listFixtures, type FixtureId } from '@pixelmapper/extension-api';
import type { NodeId, PortRef, RdmUid } from '../bridge/protocol-model';
import type { DeviceEntry } from './device-store';
import type { DeviceRuntime } from './device-runtime';
import { deviceLabel, presentDeviceSpans } from './addressing';
import { conflictsOf, deviceSpanOf, formatAddress } from './conflicts';
import { linkedFixturesOf } from './link';
import { portDisplayName, portUniverse } from './node-ports';

/** State shown per device. */
export type DeviceRowState = 'new' | 'linked' | 'conflict' | 'offline';

/** One row of the list. */
export interface DeviceRow {
  uid: RdmUid;
  port: PortRef;
  /** `Port 2`. */
  portLabel: string;
  /** `U1.13`, or `—` while unknown. */
  address: string;
  label: string;
  model: string;
  /** `2/4 · RGB (3 ch)`. */
  personality: string;
  firmware: string;
  state: DeviceRowState;
  /** What the device overlaps (names with addresses). */
  conflicts: string[];
  /** The fixture linked to the device (any link state). */
  fixtureId: FixtureId | null;
  /** A new device that can be added. */
  canAdd: boolean;
  /** The device has an address and footprint (Assign free address possible). */
  canAssign: boolean;
  entry: DeviceEntry;
}

/** Personality text of a device. */
function personalityText(d: DeviceEntry): string {
  const info = d.info;
  if (!info) return '—';
  const p = d.description?.personalities.find(x => x.index === info.currentPersonality);
  const name = p?.description ?? `${info.dmxFootprint} ch`;
  return `${info.currentPersonality}/${info.personalityCount} · ${name}`;
}

/** Rows of the devices of `nodeId()`, in store order (port, address, UID). */
export function useDeviceList(runtime: DeviceRuntime, nodeId: () => NodeId | null): { rows: ComputedRef<DeviceRow[]> } {
  const rows = computed<DeviceRow[]>(() => {
    const id = nodeId();
    if (!id) return [];
    const fixtures = listFixtures();
    const linked = new Map(linkedFixturesOf(fixtures).map(f => [f.link.uid, f.fixtureId]));
    const spans = presentDeviceSpans(runtime.store);
    return runtime.store.devicesOf(id).map((d) => {
      const universe = portUniverse(d.nodeId, d.port);
      const label = deviceLabel(d);
      const span = deviceSpanOf(d.uid, label, universe, d.info);
      const conflicts = d.present && span ? conflictsOf(span, fixtures, spans) : [];
      const fixtureId = linked.get(d.uid) ?? null;
      let state: DeviceRowState = 'new';
      if (!d.present) state = 'offline';
      else if (conflicts.length) state = 'conflict';
      else if (fixtureId !== null) state = 'linked';
      return {
        uid: d.uid,
        port: d.port,
        portLabel: portDisplayName(d.nodeId, d.port),
        address: span ? formatAddress(span.startAddress) : '—',
        label,
        model: d.description?.deviceModelDescription ?? (d.info ? `Model 0x${d.info.deviceModelId.toString(16).padStart(4, '0')}` : '—'),
        personality: personalityText(d),
        firmware: d.description?.softwareVersionLabel ?? '—',
        state,
        conflicts,
        fixtureId,
        canAdd: d.present && fixtureId === null && !!span,
        canAssign: d.present && !!span,
        entry: d,
      };
    });
  });
  return { rows };
}
