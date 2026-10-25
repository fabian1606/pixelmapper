/**
 * `connector-artnet` — Art-Net output (distribution set, ADR §5.9; ADR 0003).
 *
 * Two connector types:
 * - `artnet-node`: one connector per Art-Net 4 node found by the bridge
 *   `pmnet-bridge serve` (plan D6); outputs = the node's output ports.
 * - `artnet` (“ArtNet (manual target)”): the original connector — direct
 *   UDP in the desktop app, the old local bridge in the browser — kept
 *   unchanged for existing setups.
 *
 * Discovery (the shared bridge connection) runs only while the Connectors
 * page shows the node suggestions or at least one `artnet-node` connector
 * exists (`retainArtNetDiscovery`), so users who never use Art-Net get no
 * bridge connection and no browser local-network prompt.
 *
 * Slots: node suggestions on the Connectors page, the RDM status badge in
 * the fixture list (D15) and the RDM section of the fixture inspector
 * (`properties:after`, D18) for fixtures linked to a device.
 *
 * `activate` installs the RDM device runtime (plan M6): device store,
 * patch sync and universe guard for fixtures linked to devices; and the
 * firmware runtime (M7.4), which creates the firmware update manager on
 * the first discovery demand and re-attaches to running updates.
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { ArtNetConnector } from './artnet-connector';
import { ArtNetNodeConnector, NODE_CONNECTOR_TYPE } from './node/node-connector';
import { installDeviceRuntime } from './devices/device-runtime';
import { installFirmwareRuntime } from './firmware/firmware-runtime';
import { readLink } from './devices/link';
import { EXTENSION_VERSION } from './version';
import ArtNetSettings from './components/ArtNetSettings.vue';
import NodeConnectorSettings from './components/NodeConnectorSettings.vue';
import NodeSuggestions from './components/NodeSuggestions.vue';
import RdmStatusBadge from './components/RdmStatusBadge.vue';
import RdmInspectorSection from './inspector/RdmInspectorSection.vue';

export default defineExtension({
  id: 'connector-artnet',
  version: EXTENSION_VERSION,
  apiVersion: '^1.4.0',
  displayName: 'ArtNet output',
  description: 'Sends DMX universes as Art-Net: to Art-Net 4 nodes found on the network through the local bridge pmnet-bridge, or to a manual target (direct UDP in the desktop app, local bridge in the browser).',
  contributes: {
    connectors: [
      defineConnector({
        type: NODE_CONNECTOR_TYPE,
        label: 'Art-Net node',
        icon: 'network',
        description: 'One Art-Net 4 node on the network (found by the local bridge pmnet-bridge); its output ports become outputs.',
        direction: 'output',
        create: id => new ArtNetNodeConnector(id),
        fromConfig: (id, config) => ArtNetNodeConnector.fromConfig(id, config),
        settings: NodeConnectorSettings,
        // The settings render the port table (universe per port, D7).
        ownsOutputMapping: true,
      }),
      defineConnector({
        type: 'artnet',
        label: 'ArtNet (manual target)',
        icon: 'network',
        description: 'DMX universes to a fixed IP (direct UDP in the desktop app, local bridge in the browser).',
        direction: 'output',
        create: id => new ArtNetConnector(id),
        fromConfig: (id, config) => ArtNetConnector.fromConfig(id, config),
        settings: ArtNetSettings,
      }),
    ],
    slots: [
      // Discovered nodes without a connector, above the output connectors.
      { slot: 'connections/outputs:before', component: NodeSuggestions },
      // RDM status of fixtures linked to a device (D15), only for those.
      { slot: 'scene/fixture:badges', component: RdmStatusBadge, when: s => !!readLink(s.fixture?.extensionData as never) },
      // RDM section of the fixture inspector (D18): the properties panel provides
      // `fixture` only for a single selection, so multi-selections show nothing.
      { slot: 'properties:after', component: RdmInspectorSection, when: s => !!readLink(s.fixture?.extensionData as never) },
    ],
  },
  // RDM devices: store, sync of linked fixtures, universe guard (M6);
  // tube firmware updates, only once Art-Net is in use (M7.4).
  activate: (api) => {
    const stopDevices = installDeviceRuntime(api);
    const stopFirmware = installFirmwareRuntime();
    return () => {
      stopFirmware();
      stopDevices();
    };
  },
});
