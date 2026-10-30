/**
 * Connectors, hardware controllers and live widgets (ADR §5.7, D17, D18).
 *
 * All outputs (including ArtNet) and all hardware controllers are extensions.
 * Connector configuration is per user/device, never project state.
 * Extensions manage the user's connector instances through `connectors`
 * (API 1.4).
 */
import type { Component, Ref } from 'vue';
import { getHostApi } from './host';

// ── Connectors ──────────────────────────────────

/** Connection state of a connector. */
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** One log line. */
export interface LogLine {
  /** `Date.now()` timestamp. */
  ts: number;
  text: string;
}

/** Rendered-output state passed to connectors every frame. */
export interface ConnectorEngineState {
  /** Current tempo. */
  bpm: number;
  /** Milliseconds since the shared clock epoch. */
  elapsedMs: number;
  /** Beats since the clock epoch. */
  beatTime: number;
  /**
   * Final DMX of all universes (flat, post-override): index = absolute
   * address − 1. Do not retain beyond the call.
   */
  dmxBuffer: Uint8Array;
}

/**
 * Runtime contract of a connector instance. Extend `ConnectorBase` (from
 * this package) rather than implementing it from scratch.
 */
export interface Connector {
  readonly id: string;
  readonly meta: { readonly type: string; readonly label: string; readonly icon?: string };
  status: Ref<ConnectorStatus>;
  errorMessage: Ref<string | null>;
  logs: LogLine[];
  /** User-visible name of this instance. */
  label: Ref<string>;
  /** True while a dropped connection is being retried. */
  autoReconnect: Ref<boolean>;
  /** Number of physical DMX outputs (0 = no direct DMX output). */
  outputCount: number;
  /** `outputMapping[i]` = universe of output `i` (0 = unassigned). */
  outputMapping: Ref<number[]>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Called once per frame per active output; MUST be non-blocking. */
  sendFrame(dmxBuffer: Uint8Array, universe?: number): void;
  /** Called every frame while connected (connectors without DMX outputs). */
  onEngineState?(state: ConnectorEngineState): void;
  /** True when the host may connect on startup without a user gesture. */
  canAutoConnect(): boolean;
  /**
   * True when there is no connection for the user to manage (e.g. direct
   * UDP output): the host connects the instance as soon as it is added or
   * restored and shows no Connect/Disconnect button, only Retry on error.
   * Optional (API 1.2); absent = false.
   */
  alwaysConnected?(): boolean;
  /** Serializable per-device configuration. */
  getConfig(): Record<string, unknown>;
  /** Applies (a part of) a stored config. */
  applyConfig(config: Record<string, unknown>): void;
  /** Sets the universe of one output. */
  setOutputUniverse(outputIndex: number, universe: number): void;
}

/** An output (or input) connector type contributed by an extension. */
export interface ConnectorDefinition {
  /** Unique type, e.g. `'artnet'`, `'serial'`. */
  type: string;
  label: string;
  /** Lucide icon name (kebab-case). */
  icon: string;
  description: string;
  direction: 'output' | 'input';
  /** Create a fresh instance. */
  create(id: string): Connector;
  /** Restore an instance from its stored config. */
  fromConfig(id: string, config: Record<string, unknown>): Connector;
  /**
   * Config UI rendered on the connections page: prop `connector`, emits
   * `change(patch)`. The host applies the patch (`connector.applyConfig`)
   * and persists the config per user and device (ADR D18). Label, outputs
   * and logs are rendered by the host.
   */
  settings?: Component;
  /**
   * True when the `settings` component renders the output → universe
   * mapping itself (e.g. a port table); the host then hides its generic
   * Outputs section on the connector card. Optional (API 1.4); absent = false.
   */
  ownsOutputMapping?: boolean;
}

/** Identity helper for typing a connector definition. */
export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  return def;
}

// ── Connector set (API 1.4) ─────────────────────

/**
 * The current user's connector instances on this device (the set shown on
 * the Connectors page). Setups are per user and device, never project state
 * (ADR D18); the host persists them.
 */
export interface ConnectorSet {
  /**
   * The instances, optionally only those of one connector `type`. Reactive
   * when read inside a `computed`/template; do not mutate the array.
   */
  list(type?: string): readonly Connector[];
  /**
   * Adds an instance (e.g. created with your definition's `create` or
   * `fromConfig`) and persists it. Instances whose `alwaysConnected()` is
   * true are connected right away; others wait for the user (or connect on
   * the next start when `canAutoConnect()`).
   */
  add(connector: Connector): void;
  /** Disconnects and removes the instance with this id, and persists. No-op for unknown ids. */
  remove(id: string): void;
  /**
   * Persists the current `getConfig()` of the instance with this id. Call it
   * when a connector changed its own config outside the settings component
   * (e.g. it learned a device id or a new IP), so the change survives a
   * reload even when the card was never opened. No-op for unknown ids.
   */
  persist(id: string): void;
}

/**
 * The user's connector set (API 1.4). Works outside components (connectors,
 * plain modules); throws outside the app (no host).
 *
 * @example
 * // Add a connector for a device found on the network.
 * connectors.add(MyConnector.fromConfig(crypto.randomUUID(), { host: '2.0.0.5' }));
 * // A connector that learned something about its device saves it.
 * this.deviceId = id; connectors.persist(this.id);
 */
export const connectors: ConnectorSet = {
  list: type => getHostApi().connectors.list(type),
  add: connector => getHostApi().connectors.add(connector),
  remove: id => getHostApi().connectors.remove(id),
  persist: id => getHostApi().connectors.persist(id),
};

// ── Controllers ─────────────────────────────────

/** Information about a MIDI port used for auto-detection. */
export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
}

/** Input event from a hardware control. */
export interface ControlInputEvent {
  controlId: string;
  type: 'press' | 'release' | 'value';
  /** 0–1 for sliders/encoders/velocity. */
  value?: number;
}

/** Feedback state sent to a hardware control (LEDs). */
export type ControlFeedbackState = 'on' | 'off' | { type: 'rgb'; r: number; g: number; b: number };

/** Feedback for one control. */
export interface ControlFeedback {
  controlId: string;
  state: ControlFeedbackState;
}

/** Runtime contract of a controller driver. Extend `ControllerDriverBase`. */
export interface ControllerDriver {
  readonly id: string;
  readonly definitionKey: string;
  status: Ref<ConnectorStatus>;
  errorMessage: Ref<string | null>;
  deviceLabel: Ref<string | null>;
  logs: LogLine[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendFeedback(fb: ControlFeedback): void;
  /** Subscribe to input events; returns an unsubscribe function. */
  onInput(cb: (e: ControlInputEvent) => void): () => void;
}

/** One physical control on a controller layout. */
export interface ControllerControlDef {
  /** Stable id matching `ControlInputEvent.controlId`. */
  id: string;
  type: 'button' | 'slider' | 'encoder' | 'xy-pad';
  label?: string;
  /** Hit area in SVG viewBox coordinates. */
  rect: { x: number; y: number; w: number; h: number };
  /** Id of the SVG element representing the control (sliders: a group with `range…` track and `knob…` child). */
  svgId?: string;
  /** Default live mapping suggested when a twin is added (core `LiveMapping` shape). */
  defaultMapping?: Record<string, unknown>;
}

/** A hardware controller contributed by an extension. */
export interface ControllerDefinition {
  /** Unique key (kebab-case, vendor-prefixed, e.g. `akai-apc-mini-mk2`). */
  id: string;
  label: string;
  description: string;
  vendor?: string;
  model?: string;
  /** Auto-detection by MIDI port (optional). */
  matches?(port: MidiPortInfo): boolean;
  /** Create a driver instance. */
  createDriver(id: string): ControllerDriver;
  /** Layout SVG for the controller twin widget (no `<style>` blocks; use a viewBox). */
  layoutSvg?: string;
  /** Layout viewBox size. */
  viewBox?: { w: number; h: number };
  /** Default footprint of the twin on the live grid. */
  defaultGridSize?: { w: number; h: number };
  /** Controls on the layout. */
  controls?: ControllerControlDef[];
}

/** Identity helper for typing a controller definition. */
export function defineController(def: ControllerDefinition): ControllerDefinition {
  return def;
}

// ── Live widgets ────────────────────────────────

/** Mapping kinds a live widget can be bound to. */
export type LiveMappingType =
  | 'preset'
  | 'channel'
  | 'effect-param'
  | 'page-switch'
  | 'global-function'
  | 'dimmer-group'
  | 'position-recall'
  | 'none';

/** A live widget type. Non-core types MUST be namespaced `<extensionId>/<name>`. */
export interface LiveWidgetDefinition {
  type: string;
  label: string;
  /** Lucide icon name (kebab-case). */
  icon: string;
  /** Rendered widget; reads the `liveWidget` scope. */
  component: Component;
  /** Initial config stored in the widget's extension data. */
  defaultConfig(): Record<string, unknown>;
  /** Default grid footprint. */
  defaultSize?: { w: number; h: number };
  /** Mapping types the widget supports. */
  mappingTypes?: LiveMappingType[];
}

/** Identity helper for typing a live widget definition. */
export function defineLiveWidget(def: LiveWidgetDefinition): LiveWidgetDefinition {
  return def;
}
