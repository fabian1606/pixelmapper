/**
 * Fake WebSocket that plays the bridge side of the contract in tests:
 * records what the app sends and replays bridge messages.
 */
import { decodeFrameSet, type DecodedFrameSet } from '../frame-set';

/** A command as the app sent it (JSON parsed). */
export interface SentCommand {
  type: string;
  id: number;
  [key: string]: unknown;
}

export class FakeBridgeSocket {
  /** Every socket constructed, in order. */
  static instances: FakeBridgeSocket[] = [];

  readyState = 0;
  binaryType = '';
  bufferedAmount = 0;
  closed = false;
  readonly commands: SentCommand[] = [];
  readonly frames: Uint8Array[] = [];
  private handlers = new Map<string, ((ev: unknown) => void)[]>();

  constructor(public readonly url: string) {
    FakeBridgeSocket.instances.push(this);
  }

  /** The most recent socket. */
  static get last(): FakeBridgeSocket {
    const s = FakeBridgeSocket.instances.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.commands.push(JSON.parse(data) as SentCommand);
    else this.frames.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // ── Bridge side ──────────────────────────────

  /** Completes the upgrade. */
  open(): void {
    this.readyState = 1;
    this.fire('open', {});
  }

  /** Sends one bridge message (object → JSON text frame). */
  receive(msg: unknown): void {
    this.fire('message', { data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }

  /** Drops the connection from the bridge side (optionally with a close code, e.g. 4003). */
  drop(code?: number): void {
    this.readyState = 3;
    this.fire('close', code === undefined ? {} : { code });
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

  /** Opens, sends `hello` and answers the client `hello` (protocol 1.0.0 by default). */
  handshake(protocol = '1.0.0'): void {
    this.open();
    this.receive({ type: 'hello', bridge: '0.1.0', protocol, interfaces: [], udp: { bound: true, port: 6454, error: null } });
    this.answer('hello');
  }

  /** Decoded binary frame sets sent by the app. */
  frameSets(): (DecodedFrameSet | null)[] {
    return this.frames.map(f => decodeFrameSet(f));
  }

  private fire(type: string, ev: unknown) {
    for (const cb of this.handlers.get(type) ?? []) cb(ev);
  }
}
