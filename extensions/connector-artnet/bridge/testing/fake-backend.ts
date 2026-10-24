/**
 * In-memory `ArtNetBackend` for tests: scripted command handlers, event
 * replay and recorded DMX. Later milestones (device list, RDM pages,
 * firmware UI) test against it instead of a bridge.
 */
import { shallowRef, type ShallowRef } from 'vue';
import { BridgeCommandError, type ArtNetBackend, type BackendInfo, type BackendState, type DmxTarget } from '../backend';
import type {
  BridgeEvent,
  BridgeEventMap,
  BridgeEventType,
  CommandArgs,
  CommandResult,
  PublicCommandType,
} from '../protocol-messages';
import type { NodeState, Tod } from '../protocol-model';
import { portKey } from '../protocol-model';

/** Handler of one command type. */
type Handler<C extends PublicCommandType> = (args: CommandArgs<C>) => CommandResult<C> | Promise<CommandResult<C>>;

/** Handshake info reported by the fake bridge. */
const FAKE_INFO: BackendInfo = {
  bridgeVersion: '0.1.0',
  protocol: '1.0.0',
  interfaces: [{ name: 'en7', ip: '2.0.0.1', mask: '255.0.0.0', mac: null }],
  udp: { bound: true, port: 6454, error: null },
};

export class FakeArtNetBackend implements ArtNetBackend {
  readonly state: ShallowRef<BackendState> = shallowRef<BackendState>({ kind: 'idle' });
  /** Every command sent, in order. */
  readonly requests: { type: PublicCommandType; args: unknown }[] = [];
  /** Every DMX universe queued while connected. */
  readonly dmx: { target: DmxTarget; data: Uint8Array }[] = [];
  /** Active poll targets with their reference counts. */
  readonly pollTargets = new Map<string, number>();
  /** Calls of `reconnectNow`. */
  reconnects = 0;

  /** Nodes and TODs as a bridge would know them from the emitted events (default `nodes` snapshot). */
  readonly known = { nodes: new Map<string, NodeState>(), tods: new Map<string, Tod>() };

  private handlers = new Map<PublicCommandType, Handler<never>>();
  private listeners = new Map<BridgeEventType, Set<(e: never) => void>>();

  /** Connect immediately on `start` (default) or stay idle until `connect()`. */
  constructor(private readonly autoConnect = true) {
    this.handle('nodes', () => ({ nodes: [...this.known.nodes.values()], tods: [...this.known.tods.values()] }));
  }

  start(): void {
    if (this.state.value.kind === 'idle' && this.autoConnect) this.connect();
  }

  stop(): void {
    this.state.value = { kind: 'idle' };
  }

  reconnectNow(): void {
    this.reconnects++;
  }

  /** Simulates a completed handshake. */
  connect(): void {
    this.state.value = { kind: 'connected', url: 'ws://fake', info: FAKE_INFO };
  }

  /** Simulates a lost bridge. */
  disconnect(): void {
    this.state.value = { kind: 'unreachable', url: 'ws://fake', attempts: 1, retryInMs: 1000 };
  }

  /** Scripts the answer of a command (throw `BridgeCommandError` to fail). */
  handle<C extends PublicCommandType>(type: C, handler: Handler<C>): void {
    this.handlers.set(type, handler as unknown as Handler<never>);
  }

  /** Delivers events to subscribers, in order (and remembers nodes/TODs for the snapshot). */
  emit(...events: BridgeEvent[]): void {
    for (const event of events) {
      this.remember(event);
      for (const l of this.listeners.get(event.type) ?? []) (l as (e: BridgeEvent) => void)(event);
    }
  }

  async request<C extends PublicCommandType>(type: C, args: CommandArgs<C>): Promise<CommandResult<C>> {
    this.requests.push({ type, args });
    if (this.state.value.kind !== 'connected') throw new BridgeCommandError('notConnected', 'not connected');
    const handler = this.handlers.get(type) as Handler<C> | undefined;
    if (!handler) return {} as CommandResult<C>;
    return handler(args);
  }

  on<E extends BridgeEventType>(type: E, listener: (event: BridgeEventMap[E]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    set.add(listener as (e: never) => void);
    return () => { set!.delete(listener as (e: never) => void); };
  }

  sendDmx(target: DmxTarget, data: Uint8Array): void {
    if (this.state.value.kind === 'connected') this.dmx.push({ target, data: data.slice() });
  }

  /** Keeps the snapshot consistent with the events, like the bridge (contract §1 Ordering). */
  private remember(event: BridgeEvent) {
    if (event.type === 'node') this.known.nodes.set(event.node.nodeId, event.node);
    if (event.type === 'nodeGone') {
      this.known.nodes.delete(event.nodeId);
      for (const [key, tod] of this.known.tods) if (tod.nodeId === event.nodeId) this.known.tods.delete(key);
    }
    if (event.type === 'tod') {
      const { type: _type, ...tod } = event;
      this.known.tods.set(`${tod.nodeId}|${portKey(tod.port)}`, tod);
    }
  }

  addPollTarget(ip: string): () => void {
    this.pollTargets.set(ip, (this.pollTargets.get(ip) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.pollTargets.get(ip) ?? 1) - 1;
      if (left > 0) this.pollTargets.set(ip, left);
      else this.pollTargets.delete(ip);
    };
  }
}
