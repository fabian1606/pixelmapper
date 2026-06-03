import { SerialConnector } from './serial-connector';
import { WebSocketConnector } from './websocket-connector';
import { ArtNetConnector } from './artnet-connector';
import { EspNowBridgeConnector } from './espnow-bridge-connector';
import type { BaseConnector } from './base-connector';
import type { FixtureSlot } from './websocket-connector';

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
  {
    type: 'artnet',
    label: 'ArtNet (lokale Bridge)',
    icon: 'Network',
    create: (id) => new ArtNetConnector(id),
  },
  {
    type: 'espnow-bridge',
    label: 'ESP-NOW USB-Bridge (ESP32-S3)',
    icon: 'RadioTower',
    create: (id) => new EspNowBridgeConnector(id),
  },
  // Future entries — add class + one line here:
  // { type: 'dmx-usb', label: 'DMX USB',  icon: 'Plug',    create: (id) => new DmxUsbConnector(id) },
];

/** Input connector registry (ArtNet In, MIDI, OSC — coming soon). */
export const INPUT_CONNECTOR_REGISTRY: ConnectorRegistryEntry[] = [];

/** Reconstruct a connector from a persisted snapshot. Returns null for unknown types. */
export function fromConfig(type: string, id: string, config: Record<string, unknown>): BaseConnector | null {
  if (type === 'websocket')     return WebSocketConnector.fromConfig(id, config);
  if (type === 'serial')        return SerialConnector.fromConfig(id, config);
  if (type === 'artnet')        return ArtNetConnector.fromConfig(id, config);
  if (type === 'espnow-bridge') return EspNowBridgeConnector.fromConfig(id, config);
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
    // setFixtureSlots/setFixtureId clear resync caches — must use the methods.
    if ('fixtureSlots' in config && Array.isArray(config.fixtureSlots)) {
      c.setFixtureSlots((config.fixtureSlots as FixtureSlot[]));
    } else if ('fixtureId' in config) {
      c.setFixtureId((config.fixtureId as string | number | null) ?? null);
    }
  } else if (c instanceof SerialConnector) {
    if ('baudRate' in config) c.baudRate = Number(config.baudRate ?? 921600);
  } else if (c instanceof EspNowBridgeConnector) {
    if ('label'     in config) c.label.value = String(config.label ?? '');
    if ('baudRate'  in config) c.baudRate    = Number(config.baudRate ?? 115200);
    if ('fixtureId' in config) c.setFixtureId((config.fixtureId as string | number | null) ?? null);
  } else if (c instanceof ArtNetConnector) {
    if ('bridgeUrl'  in config) c.bridgeUrl.value  = String(config.bridgeUrl ?? '');
    if ('targetIp'   in config) c.targetIp.value   = String(config.targetIp ?? '');
    if ('artnetPort' in config) c.artnetPort.value = Number(config.artnetPort ?? 6454);
    if ('label'      in config) c.label.value      = String(config.label ?? '');
    if ('outputCount' in config) c.setOutputCount(Number(config.outputCount ?? 1));
    c.syncConfig();
  }
  if ('outputMapping' in config && Array.isArray(config.outputMapping)) {
    c.outputMapping.value = (config.outputMapping as number[]).slice();
  }
}

/** @deprecated Use OUTPUT_CONNECTOR_REGISTRY */
export const CONNECTOR_REGISTRY = OUTPUT_CONNECTOR_REGISTRY;
