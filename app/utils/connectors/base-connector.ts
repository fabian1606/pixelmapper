export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectorMeta {
  readonly type: string;
  readonly label: string;
  readonly icon?: string;
}

export interface LogLine {
  ts: number; // Date.now()
  text: string;
}

import { reactive, ref } from 'vue';

export interface EngineConnectorState {
  bpm: number;
  elapsedMs: number;
  layoutRevision: number;
  channelsRevision: number;
  effectsRevision: number;
  layoutPacket: Uint8Array;
  channelsPacket: Uint8Array;
  effectsPacket: Uint8Array;
}

export abstract class BaseConnector {
  readonly id: string;
  abstract readonly meta: ConnectorMeta;

  status = ref<ConnectorStatus>('disconnected');
  errorMessage = ref<string | null>(null);
  logs: LogLine[] = reactive([]);

  protected pushLog(text: string) {
    this.logs.push({ ts: Date.now(), text });
    if (this.logs.length > 500) this.logs.shift();
  }

  constructor(id: string) {
    this.id = id;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  /**
   * Called once per frame (post-render) by the connections store.
   * Must be non-blocking — fire-and-forget async writes only.
   */
  abstract sendFrame(dmxBuffer: Uint8Array): void;

  /** Optional: called when engine state changes (BPM, binary packets, time).
   *  Implement this instead of sendFrame for connectors that run their own renderer. */
  onEngineState?(state: EngineConnectorState): void;

  getConfig(): Record<string, unknown> {
    return {};
  }
}
