/**
 * `connector-artnet` — ArtNet output: direct UDP in the desktop app, a
 * local bridge in the browser (distribution set, ADR §5.9; ADR 0003).
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { ArtNetConnector } from './artnet-connector';
import ArtNetSettings from './components/ArtNetSettings.vue';

export default defineExtension({
  id: 'connector-artnet',
  version: '1.1.0',
  apiVersion: '^1.1.0',
  displayName: 'ArtNet output',
  description: 'Sends DMX universes as ArtNet: directly over UDP in the desktop app, through a local WebSocket→UDP bridge in the browser.',
  contributes: {
    connectors: [defineConnector({
      type: 'artnet',
      label: 'ArtNet',
      icon: 'network',
      description: 'DMX universes to ArtNet nodes (direct UDP in the desktop app, local bridge in the browser).',
      direction: 'output',
      create: id => new ArtNetConnector(id),
      fromConfig: (id, config) => ArtNetConnector.fromConfig(id, config),
      settings: ArtNetSettings,
    })],
  },
});
