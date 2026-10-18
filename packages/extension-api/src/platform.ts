/**
 * Platform contract (ADR 0003).
 *
 * Transport-shaped access to I/O that differs between the web app and the
 * native (Tauri) app: UDP datagrams, serial ports, MIDI ports, native HTTP
 * and bundled resources. Protocol logic stays in the callers;
 * implementations only move bytes.
 *
 * A capability the current platform cannot provide is `null`. Callers must
 * check for it and fall back or show a clear message.
 */
import { getHostApi } from './host';
import type { MidiPortInfo } from './connectors';

/** Which runtime the app is running in. */
export type PlatformKind = 'web' | 'tauri';

// ── UDP ─────────────────────────────────────────────

/** Options for opening a UDP socket. */
export interface UdpBindOptions {
  /** Local port; 0 or omitted = any free port. */
  port?: number;
  /** Allow sending to broadcast addresses (e.g. `2.255.255.255`). */
  broadcast?: boolean;
}

/** An open UDP socket. */
export interface UdpSocket {
  /** Sends one datagram (fire-and-forget; errors are logged by the platform). */
  send(data: Uint8Array, host: string, port: number): void;
  /** Closes the socket. */
  close(): Promise<void>;
}

/** Direct UDP access (native only). */
export interface UdpApi {
  bind(options?: UdpBindOptions): Promise<UdpSocket>;
}

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

// ── HTTP ────────────────────────────────────────────

/**
 * Native HTTP GET without browser CORS restrictions (API 1.3).
 * Native implementations MAY restrict the allowed hosts (the desktop app
 * allows the GitHub release hosts only).
 */
export interface HttpApi {
  /** Downloads a URL (redirects followed); rejects on network errors and non-2xx answers. */
  getBytes(url: string): Promise<Uint8Array>;
}

// ── Bundled resources ───────────────────────────────

/**
 * Read-only files shipped inside the app bundle (API 1.3), e.g. the
 * firmware matching the app release (ADR 0004 D19).
 */
export interface ResourcesApi {
  /**
   * Reads a bundled file by its relative path (e.g. `firmware/firmware.bin`).
   * Resolves `null` when the file was not bundled.
   */
  read(path: string): Promise<Uint8Array | null>;
}

// ── Platform ────────────────────────────────────────

/** Platform-dependent capabilities. `null` = not available here. */
export interface Platform {
  readonly kind: PlatformKind;
  readonly udp: UdpApi | null;
  readonly serial: SerialApi | null;
  readonly midi: MidiApi | null;
  /** Native HTTP (desktop). Optional: hosts before API 1.3 omit it — treat absent as `null`. */
  readonly http?: HttpApi | null;
  /** Files bundled with the app (desktop). Optional: absent = `null` (API 1.3). */
  readonly resources?: ResourcesApi | null;
}

/** Returns the platform of the running host (connectors, drivers, components). */
export function getPlatform(): Platform {
  return getHostApi().platform;
}
