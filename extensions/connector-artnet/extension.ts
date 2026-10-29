/**
 * `connector-artnet` — Art-Net output (distribution set, ADR §5.9; ADR 0003).
 *
 * One connector type, `artnet`: one connector per Art-Net device, reached
 * through the Art-Net bridge (`pmnet-bridge serve` in the browser, built
 * into the desktop app; plan D6). A device found by ArtPoll gives its output
 * ports as outputs, plus RDM devices, node configuration and tube firmware
 * where it supports them. A device added by IP that never answers ArtPoll
 * (old Art-Net 1/2 gear, some software) is a manual target: universe →
 * Port-Address outputs, unicast ArtDmx through the bridge's `ip` routes.
 *
 * Discovery (the shared bridge connection) runs only while the Connectors
 * page shows the device suggestions or at least one `artnet` connector
 * exists (`retainArtNetDiscovery`), so users who never use Art-Net get no
 * bridge connection and no browser local-network prompt.
 *
 * Slots: node suggestions on the Connectors page, the RDM status badge in
 * the fixture list (D15) and the RDM section of the fixture inspector
 * (`selection:after`, below address and mode, D18) for fixtures linked to
 * a device.
 *
 * `activate` installs the RDM device runtime (plan M6): device store,
 * patch sync and universe guard for fixtures linked to devices; and the
 * firmware runtime (M7.4), which creates the firmware update manager on
 * the first discovery demand and re-attaches to running updates.
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { ArtNetNodeConnector, NODE_CONNECTOR_TYPE } from './node/node-connector';
import { installDeviceRuntime } from './devices/device-runtime';
import { installFirmwareRuntime } from './firmware/firmware-runtime';
import { readLink } from './devices/link';
import { EXTENSION_VERSION } from './version';
import NodeConnectorSettings from './components/NodeConnectorSettings.vue';
import NodeSuggestions from './components/NodeSuggestions.vue';
import RdmStatusBadge from './components/RdmStatusBadge.vue';
import RdmInspectorSection from './inspector/RdmInspectorSection.vue';

export default defineExtension({
  id: 'connector-artnet',
  version: EXTENSION_VERSION,
  apiVersion: '^1.5.0',
  displayName: 'Art-Net output',
  description: 'Sends DMX universes as Art-Net through the Art-Net bridge (built into the desktop app, pmnet-bridge in the browser): to devices found on the network, or to a device IP that does not answer ArtPoll.',
  contributes: {
    connectors: [
      defineConnector({
        type: NODE_CONNECTOR_TYPE,
        label: 'Art-Net',
        icon: 'network',
        description: 'One Art-Net device: found on the network (its output ports become outputs) or added by IP (universe → Port-Address).',
        direction: 'output',
        create: id => new ArtNetNodeConnector(id),
        fromConfig: (id, config) => ArtNetNodeConnector.fromConfig(id, config),
        settings: NodeConnectorSettings,
        // The settings render the port table (universe per port, D7).
        ownsOutputMapping: true,
      }),
    ],
    slots: [
      // Discovered devices without a connector, above the output connectors.
      { slot: 'connections/outputs:before', component: NodeSuggestions },
      // RDM status of fixtures linked to a device (D15), only for those.
      { slot: 'scene/fixture:badges', component: RdmStatusBadge, when: s => !!readLink(s.fixture?.extensionData as never) },
      // RDM section of the fixture inspector (D18), below address and mode: the
      // slot exists for a single selected fixture only (scope `fixture`).
      { slot: 'selection:after', component: RdmInspectorSection, when: s => !!readLink(s.fixture?.extensionData as never) },
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
