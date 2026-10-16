/**
 * `connector-esp` — Pixelmapper ESP32 nodes (catalog extension, ADR §5.9):
 * USB serial DMX nodes, WebSocket LED strip nodes and the ESP-NOW USB
 * bridge. One extension because all three speak the same firmware protocol
 * (`protocol.ts`, ADR D16). Strip nodes read `neopixel-strip` fixtures by
 * kind id.
 */
import { defineConnector, defineExtension } from '@pixelmapper/extension-api';
import { EspSerialConnector } from './serial-connector';
import { WsStripConnector } from './ws-strip-connector';
import { EspNowBridgeConnector } from './espnow-bridge-connector';
import SerialSettings from './components/SerialSettings.vue';
import StripNodeSettings from './components/StripNodeSettings.vue';
import EspNowSettings from './components/EspNowSettings.vue';

export default defineExtension({
  id: 'connector-esp',
  version: '1.0.0',
  apiVersion: '^1.0.0',
  displayName: 'ESP32 nodes',
  description: 'Outputs to Pixelmapper ESP32 firmware: USB serial DMX nodes, WebSocket LED strip nodes and the ESP-NOW audience bridge.',
  contributes: {
    connectors: [
      defineConnector({
        type: 'serial',
        label: 'USB Serial (ESP32)',
        icon: 'usb',
        description: 'ESP32 DMX node over USB (Web Serial); streams mapped universes and updates its firmware.',
        direction: 'output',
        create: id => new EspSerialConnector(id),
        fromConfig: (id, config) => EspSerialConnector.fromConfig(id, config),
        settings: SerialSettings,
      }),
      defineConnector({
        type: 'websocket',
        label: 'WebSocket LED strip (ESP32-S3)',
        icon: 'wifi',
        description: 'ESP32-S3 node driving NeoPixel strips on GPIO pins; streams rendered pixels over WebSocket.',
        direction: 'output',
        create: id => new WsStripConnector(id),
        fromConfig: (id, config) => WsStripConnector.fromConfig(id, config),
        settings: StripNodeSettings,
      }),
      defineConnector({
        type: 'espnow-bridge',
        label: 'ESP-NOW USB bridge (ESP32-S3)',
        icon: 'radio-tower',
        description: 'Broadcasts one fixture\'s color via ESP-NOW to audience devices.',
        direction: 'output',
        create: id => new EspNowBridgeConnector(id),
        fromConfig: (id, config) => EspNowBridgeConnector.fromConfig(id, config),
        settings: EspNowSettings,
      }),
    ],
  },
});
