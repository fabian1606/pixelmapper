/**
 * `connector-artnet` — Art-Net output (distribution set, ADR §5.9; ADR 0003).
 *
 * Two connector types:
 * - `artnet-node`: one connector per Art-Net 4 node found by the bridge
 *   `pmnet serve` (plan D6); outputs = the node's output ports.
 * - `artnet` (“ArtNet (manual target)”): the original connector — direct
 *   UDP in the desktop app, the old local bridge in the browser — kept
 *   unchanged for existing setups.
 *
 * Discovery (the shared bridge connection) runs only while the Connectors
 * page shows the node suggestions or at least one `artnet-node` connector
 * exists (`retainArtNetDiscovery`), so users who never use Art-Net get no
 * bridge connection and no browser local-network prompt.
 *
 * `activate` installs the RDM device runtime (plan M6): device store,
 * patch sync and universe guard for fixtures linked to devices.
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { ArtNetConnector } from './artnet-connector';
import { ArtNetNodeConnector, NODE_CONNECTOR_TYPE } from './node/node-connector';
import { installDeviceRuntime } from './devices/device-runtime';
import { readLink } from './devices/link';
import { EXTENSION_VERSION } from './version';
import ArtNetSettings from './components/ArtNetSettings.vue';
import NodeConnectorSettings from './components/NodeConnectorSettings.vue';
import NodeSuggestions from './components/NodeSuggestions.vue';
import RdmStatusBadge from './components/RdmStatusBadge.vue';

export default defineExtension({
  id: 'connector-artnet',
  version: EXTENSION_VERSION,
  apiVersion: '^1.4.0',
  displayName: 'ArtNet output',
  description: 'Sends DMX universes as Art-Net: to Art-Net 4 nodes found on the network through the local bridge pmnet, or to a manual target (direct UDP in the desktop app, local bridge in the browser).',
  contributes: {
    connectors: [
      defineConnector({
        type: NODE_CONNECTOR_TYPE,
        label: 'Art-Net node',
        icon: 'network',
        description: 'One Art-Net 4 node on the network (found by the pmnet bridge); its output ports become outputs.',
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
    ],
  },
  // RDM devices: store, sync of linked fixtures, universe guard (M6).
  activate: api => installDeviceRuntime(api),
});
