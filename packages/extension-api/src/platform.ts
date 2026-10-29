/**
 * Platform contract (ADR 0003).
 *
 * Transport-shaped access to I/O that differs between the web app and the
 * native (Tauri) app: serial ports, MIDI ports and the in-process Art-Net
 * bridge. Protocol logic stays in the callers;
 * implementations only move bytes.
 *
 * A capability the current platform cannot provide is `null`. Callers must
 * check for it and fall back or show a clear message.
 */
import { getHostApi } from './host';
import type { MidiPortInfo } from './connectors';

/** Which runtime the app is running in. */
export type PlatformKind = 'web' | 'tauri';

// ── Serial ──────────────────────────────────────────

/** Options for opening a serial port. */
export interface SerialOpenOptions {
  baudRate: number;
}

/** Callbacks of an open serial connection. */
export interface SerialEvents {
  /** A chunk of received bytes. */
  onData(chunk: Uint8Array): void;
  /** The port closed unexpectedly (device unplugged, read error). Not called after `close()`. */
  onDrop(error: Error): void;
}

/** An open serial connection. */
export interface SerialConnection {
  /** Writes bytes; rejects when the port is gone. */
  write(data: Uint8Array): Promise<void>;
  /** Closes the port. Idempotent. */
  close(): Promise<void>;
}

/**
 * A serial port the user granted. Can be opened again after a close without
 * a new user gesture. Errors whose `name` is `NotFoundError` mean the device
 * is gone and the port must be requested again.
 */
export interface SerialPortHandle {
  open(options: SerialOpenOptions, events: SerialEvents): Promise<SerialConnection>;
}

/** Serial port access. */
export interface SerialApi {
  /** Lets the user pick a port. Web: must be called from a user gesture. */
  requestPort(): Promise<SerialPortHandle>;
}

// ── MIDI ────────────────────────────────────────────

/** A MIDI input port. */
export interface MidiInputPort extends MidiPortInfo {
  /** Subscribes to incoming messages; returns the unsubscribe function. */
  onMessage(cb: (data: Uint8Array) => void): () => void;
}

/** A MIDI output port. */
export interface MidiOutputPort extends MidiPortInfo {
  /** Sends one message (including sysex). */
  send(data: number[] | Uint8Array): void;
}

/** A port appeared or disappeared. */
export interface MidiStateChange {
  port: MidiPortInfo;
  direction: 'input' | 'output';
  state: 'connected' | 'disconnected';
}

/** Granted MIDI access. */
export interface MidiAccessHandle {
  inputs(): MidiInputPort[];
  outputs(): MidiOutputPort[];
  /** Subscribes to hot-plug events; returns the unsubscribe function. */
  onStateChange(cb: (change: MidiStateChange) => void): () => void;
}

/** MIDI access. */
export interface MidiApi {
  /** Requests access. Web: may show a permission prompt (user gesture). */
  requestAccess(options?: { sysex?: boolean }): Promise<MidiAccessHandle>;
}

// ── Art-Net bridge ──────────────────────────────────

/**
 * Callbacks of an in-process Art-Net bridge session. They carry exactly the
 * messages of the bridge WebSocket contract (`protocol/bridge-ws.md`), so the
 * caller keeps all protocol logic.
 *
 * No callback runs before `connect()` has resolved: messages the bridge sends
 * earlier (its `hello`) are queued and delivered in order afterwards. Nothing
 * is delivered after `onClose` or after `ArtNetBridgeSession.close()`.
 */
export interface ArtNetBridgeHandlers {
  /** One JSON text message of the bridge (event, result or error). */
  onMessage(text: string): void;
  /**
   * The bridge ended the session: a contract close code (4001/4002/4003/1001)
   * or 1006 with an empty reason when it ended without one. Not called after
   * the caller's own `close()`.
   */
  onClose(code: number, reason: string): void;
}

/** An open session with the in-process Art-Net bridge. */
export interface ArtNetBridgeSession {
  /** Sends one JSON text message; rejects when the session is gone. */
  sendText(text: string): Promise<void>;
  /** Sends one binary message (DMX frame set); fire-and-forget, failures are logged. */
  sendBinary(data: Uint8Array): void;
  /** Bytes of binary messages handed over but not yet accepted by the bridge (backpressure). */
  readonly bufferedAmount: number;
  /** Ends the session. Idempotent. */
  close(): void;
}

/**
 * The Art-Net bridge running inside the app (desktop only): the same bridge
 * core as `pmnet-bridge serve`, reached without a WebSocket.
 */
export interface ArtNetBridgeApi {
  /** Opens a session; rejects (Error) when the bridge cannot start. */
  connect(handlers: ArtNetBridgeHandlers): Promise<ArtNetBridgeSession>;
}

// ── Platform ────────────────────────────────────────

/** Platform-dependent capabilities. `null` = not available here. */
export interface Platform {
  readonly kind: PlatformKind;
  readonly serial: SerialApi | null;
  readonly midi: MidiApi | null;
  /** In-process Art-Net bridge (desktop, API 1.5); `null` = use `pmnet-bridge serve` over WebSocket. */
  readonly artnetBridge: ArtNetBridgeApi | null;
}

/** Returns the platform of the running host (connectors, drivers, components). */
export function getPlatform(): Platform {
  return getHostApi().platform;
}
