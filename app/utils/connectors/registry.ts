import { SerialConnector } from './serial-connector';
import { WebSocketConnector } from './websocket-connector';
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
  {
    type: 'websocket',
    label: 'WebSocket LED-Strip (ESP32-S3)',
    icon: 'Wifi',
    create: (id) => new WebSocketConnector(id),
  },
  // Future entries — add class + one line here:
  // { type: 'artnet',  label: 'ArtNet',   icon: 'Network', create: (id) => new ArtNetConnector(id) },
  // { type: 'dmx-usb', label: 'DMX USB',  icon: 'Plug',    create: (id) => new DmxUsbConnector(id) },
];

/** Input connector registry (ArtNet In, MIDI, OSC — coming soon). */
export const INPUT_CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [];

/** Reconstruct a connector from a persisted snapshot. Returns null for unknown types. */
export function fromConfig(type: string, id: string, config: Record<string, unknown>): BaseConnector | null {
  if (type === 'websocket') return WebSocketConnector.fromConfig(id, config);
  if (type === 'serial')    return SerialConnector.fromConfig(id, config);
  return null;
}

/**
 * Apply a config blob to an EXISTING connector instance.
 *
 * Used by `UpdateConnectorConfigCommand` so an edit reuses the same object
 * (preserving the WebSocket socket / SerialPort handle and `status` ref the
 * card binds to). Only keys actually present in `config` are written — that
 * way partial payloads from older clients don't clobber unrelated fields.
 */
export function applyConfig(c: BaseConnector, config: Record<string, unknown>): void {
  if (c instanceof WebSocketConnector) {
    if ('url'   in config) c.url.value   = String(config.url ?? '');
    if ('label' in config) c.label.value = String(config.label ?? '');
    if ('devicePin' in config) c.devicePin.value = config.devicePin != null ? Number(config.devicePin) : null;
    if ('espNowFixtureId' in config) c.espNowFixtureId.value = (config.espNowFixtureId as string | number | null | undefined) ?? null;
    if ('espNowEnabled'   in config) c.espNowEnabled.value   = config.espNowEnabled === true;
    // setFixtureSlots/setFixtureId clear resync caches — must use the methods.
    if ('fixtureSlots' in config && Array.isArray(config.fixtureSlots)) {
      c.setFixtureSlots((config.fixtureSlots as import('./websocket-connector').FixtureSlot[]));
    } else if ('fixtureId' in config) {
      c.setFixtureId((config.fixtureId as string | number | null) ?? null);
    }
  } else if (c instanceof SerialConnector) {
    if ('baudRate' in config) c.baudRate = Number(config.baudRate ?? 921600);
  }
  if ('outputMapping' in config && Array.isArray(config.outputMapping)) {
    c.outputMapping.value = (config.outputMapping as number[]).slice();
  }
}

/** @deprecated Use OUTPUT_CONNECTOR_REGISTRY */
export const CONNECTOR_REGISTRY = OUTPUT_CONNECTOR_REGISTRY;
