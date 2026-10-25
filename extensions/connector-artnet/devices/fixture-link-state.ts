/**
 * Everything about one linked fixture in one place: its link, device, port
 * universe, mode ↔ personality maps and badge status. Reactive when called
 * inside a `computed` (reads the device store, node connectors and the
 * runtime's map cache).
 */
import type { DeepReadonly } from 'vue';
import type { FixtureView, Json } from '@pixelmapper/extension-api';
import type { DeviceEntry } from './device-store';
import type { DeviceRuntime, PersonalityMaps } from './device-runtime';
import { readLink, type RdmLink } from './link';
import { computeLinkStatus, isEffectivelyLinked, type LinkStatus } from './link-status';
import { connectorOfNode, nodeDisplayName, portDisplayName, portUniverse } from './node-ports';

/** The fixture fields this module reads (a `FixtureView` or `FixtureSummary`-like object). */
export type LinkedFixtureView = Pick<DeepReadonly<FixtureView>, 'id' | 'universe' | 'localAddress' | 'source' | 'extensionData'>;

/** State of a fixture with a link. */
export interface FixtureLinkState {
  link: RdmLink;
  device: DeviceEntry | undefined;
  /** Universe of the link's node port (null: no connector / not an output). */
  portUniverse: number | null;
  /** "PM Node port 2". */
  portName: string;
  /** True while changes are pushed to the device (D14). */
  effective: boolean;
  /** Mode ↔ personality of the fixture's definition, null while unknown. */
  maps: PersonalityMaps | null;
  status: LinkStatus;
}

/** State of the fixture's link, or null when it has none. */
export function fixtureLinkState(runtime: DeviceRuntime, view: LinkedFixtureView): FixtureLinkState | null {
  const link = readLink(view.extensionData as Record<string, Record<string, Json>> | undefined);
  if (!link) return null;
  const device = runtime.store.get(link.uid);
  const universe = portUniverse(link.nodeId, link.port);
  const portName = `${nodeDisplayName(link.nodeId)} ${portDisplayName(link.nodeId, link.port).toLowerCase()}`;
  const maps = view.source ? runtime.cachedPersonalityMaps(view.source.key, device) : null;
  const modeIndex = view.source?.modeIndex;
  const status = computeLinkStatus({
    link,
    fixture: { universe: view.universe, localAddress: view.localAddress, modeIndex },
    portUniverse: universe,
    portName,
    device,
    bridgeConnected: runtime.backend.state.value.kind === 'connected',
    nodeOnline: !!connectorOfNode(link.nodeId)?.node.value,
    personalityOfMode: modeIndex !== undefined ? maps?.personalityByMode[modeIndex] : undefined,
  });
  return { link, device, portUniverse: universe, portName, effective: isEffectivelyLinked(link, view.universe, universe), maps, status };
}
