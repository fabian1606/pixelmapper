/**
 * `connector-artnet` — ArtNet output through a local bridge (distribution
 * set, ADR §5.9).
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { ArtNetConnector } from './artnet-connector';
import ArtNetSettings from './components/ArtNetSettings.vue';

export default defineExtension({
  id: 'connector-artnet',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'ArtNet output',
  description: 'Sends DMX universes as ArtNet through a local WebSocket→UDP bridge.',
  contributes: {
    connectors: [defineConnector({
      type: 'artnet',
      label: 'ArtNet (local bridge)',
      icon: 'network',
      description: 'DMX universes to ArtNet nodes via a local bridge process.',
      direction: 'output',
      create: id => new ArtNetConnector(id),
      fromConfig: (id, config) => ArtNetConnector.fromConfig(id, config),
      settings: ArtNetSettings,
    })],
  },
});
