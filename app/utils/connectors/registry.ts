import { SerialConnector } from './serial-connector';
import type { BaseConnector } from './base-connector';

export interface ConnectorRegistryEntry {
  type: string;
  label: string;
  icon: string;
  create: (id: string) => BaseConnector;
}

export const OUTPUT_CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [
  {
    type: 'serial',
    label: 'USB Serial (ESP32)',
    icon: 'Usb',
    create: (id) => new SerialConnector(id),
  },
  // Future entries — add class + one line here:
  // { type: 'artnet',  label: 'ArtNet',   icon: 'Network', create: (id) => new ArtNetConnector(id) },
  // { type: 'dmx-usb', label: 'DMX USB',  icon: 'Plug',    create: (id) => new DmxUsbConnector(id) },
];

/** Input connector registry (ArtNet In, MIDI, OSC — coming soon). */
export const INPUT_CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [];

/** @deprecated Use OUTPUT_CONNECTOR_REGISTRY */
export const CONNECTOR_REGISTRY = OUTPUT_CONNECTOR_REGISTRY;
