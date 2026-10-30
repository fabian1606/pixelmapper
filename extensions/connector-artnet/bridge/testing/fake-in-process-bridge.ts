/**
 * Fake `ArtNetBridgeApi` (the desktop app's built-in bridge) for tests:
 * every `connect()` creates a `FakeBridgeSession` that records what the app
 * sends and plays the bridge side. `connect()` resolves only on `accept()`,
 * so tests can deliver messages before the session is handed out.
 */
import type { ArtNetBridgeApi, ArtNetBridgeHandlers, ArtNetBridgeSession } from '@pixelmapper/extension-api';
import { decodeFrameSet, type DecodedFrameSet } from '../frame-set';
import type { SentCommand } from './fake-socket';

/** Resolves or rejects a pending `connect()`. */
interface ConnectSettle {
  resolve: (s: ArtNetBridgeSession) => void;
  reject: (e: Error) => void;
}

/** One session of the fake bridge (both the bridge side and the app's handle). */
export class FakeBridgeSession implements ArtNetBridgeSession {
  readonly commands: SentCommand[] = [];
  readonly frames: Uint8Array[] = [];
  bufferedAmount = 0;
  closed = false;
  /** When set, `sendText` rejects with this message (session gone on the native side). */
  rejectSends: string | null = null;
  private settle: ConnectSettle | null = null;

  constructor(private readonly handlers: ArtNetBridgeHandlers, settle: ConnectSettle | null) {
    this.settle = settle;
  }

  // ── App side (ArtNetBridgeSession) ───────────

  sendText(text: string): Promise<void> {
    if (this.rejectSends) return Promise.reject(new Error(this.rejectSends));
    this.commands.push(JSON.parse(text) as SentCommand);
    return Promise.resolve();
  }

  sendBinary(data: Uint8Array): void {
    this.frames.push(data);
  }

  close(): void {
    this.closed = true;
  }

  // ── Bridge side ──────────────────────────────

  /** Resolves `connect()`. */
  accept(): void {
    this.settle?.resolve(this);
    this.settle = null;
  }

  /** Rejects `connect()` (the bridge could not start). */
  refuse(message: string): void {
    this.settle?.reject(new Error(message));
    this.settle = null;
  }

  /** Sends one bridge message (object → JSON text). */
  receive(msg: unknown): void {
    this.handlers.onMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Ends the session from the bridge side. */
  drop(code = 1006, reason = ''): void {
    this.handlers.onClose(code, reason);
  }

  /** The last command of a type. */
  command(type: string): SentCommand | undefined {
    return this.commands.filter(c => c.type === type).at(-1);
  }

  /** Answers the last command of `type` with `result`. */
  answer(type: string, result: unknown = {}): void {
    const cmd = this.command(type);
    if (!cmd) throw new Error(`no ${type} command`);
    this.receive({ type: 'result', id: cmd.id, result });
  }

  /** The bridge's `hello` (protocol 1.0.0 by default). */
  hello(protocol = '1.0.0'): void {
    this.receive({ type: 'hello', bridge: '0.2.0', protocol, interfaces: [], udp: { bound: true, port: 6454, error: null } });
  }

  /** Decoded binary frame sets sent by the app. */
  frameSets(): (DecodedFrameSet | null)[] {
    return this.frames.map(f => decodeFrameSet(f));
  }
}

/** The fake bridge API; `sessions` holds every connect attempt in order. */
export class FakeInProcessBridge implements ArtNetBridgeApi {
  readonly sessions: FakeBridgeSession[] = [];

  connect(handlers: ArtNetBridgeHandlers): Promise<ArtNetBridgeSession> {
    let settle: ConnectSettle | null = null;
    const promise = new Promise<ArtNetBridgeSession>((resolve, reject) => { settle = { resolve, reject }; });
    this.sessions.push(new FakeBridgeSession(handlers, settle));
    return promise;
  }

  /** The most recent session. */
  get last(): FakeBridgeSession {
    const s = this.sessions.at(-1);
    if (!s) throw new Error('no session');
    return s;
  }
}
