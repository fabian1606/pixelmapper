/**
 * Connectors, hardware controllers and live widgets (ADR §5.7, D17, D18).
 *
 * All outputs (including ArtNet) and all hardware controllers are extensions.
 * Connector configuration is per user/device, never project state.
 */
import type { Component, Ref } from 'vue';

// ── Connectors ──────────────────────────────────

/** Connection state of a connector. */
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** One log line. */
export interface LogLine {
  /** `Date.now()` timestamp. */
  ts: number;
  text: string;
}

/**
 * Runtime contract of a connector instance. Structurally matches the core
 * `BaseConnector`; a reusable base class is provided by the host from plan P6.
 */
export interface Connector {
  readonly id: string;
  readonly meta: { readonly type: string; readonly label: string; readonly icon?: string };
  status: Ref<ConnectorStatus>;
  errorMessage: Ref<string | null>;
  logs: LogLine[];
  /** Number of physical DMX outputs (0 = no direct DMX output). */
  outputCount: number;
  /** `outputMapping[i]` = universe of output `i` (0 = unassigned). */
  outputMapping: Ref<number[]>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Called once per frame per active output; MUST be non-blocking. */
  sendFrame(dmxBuffer: Uint8Array, universe?: number): void;
  /** Serializable per-device configuration. */
  getConfig(): Record<string, unknown>;
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
  /** Config UI rendered on the connections page. */
  settings?: Component;
}

/** Identity helper for typing a connector definition. */
export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  return def;
}

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

/** Runtime contract of a controller driver (mirrors `BaseControllerDriver`). */
export interface ControllerDriver {
  readonly id: string;
  readonly definitionKey: string;
  status: Ref<ConnectorStatus>;
  errorMessage: Ref<string | null>;
  deviceLabel: Ref<string | null>;
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
  /** Id of the SVG element representing the control. */
  svgId?: string;
}

/** A hardware controller contributed by an extension. */
export interface ControllerDefinition {
  /** Unique key. */
  id: string;
  label: string;
  description: string;
  vendor?: string;
  model?: string;
  /** Auto-detection. */
  matches(port: MidiPortInfo): boolean;
  /** Create a driver instance. */
  createDriver(id: string): ControllerDriver;
  /** Layout SVG for the controller twin widget. */
  layoutSvg?: string;
  /** Layout viewBox size. */
  viewBox?: { w: number; h: number };
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
