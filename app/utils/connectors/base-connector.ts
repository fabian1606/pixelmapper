import { reactive, ref, shallowRef } from 'vue';

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

  /** Number of physical DMX outputs this connector has (0 = parameter-based, no direct DMX output). */
  outputCount = 0;

  /**
   * Mapping from output index to universe number.
   * outputMapping[i] = universe number for output i (0 = unassigned).
   * Array length always equals outputCount.
   */
  outputMapping = shallowRef<number[]>([]);

  protected pushLog(text: string) {
    this.logs.push({ ts: Date.now(), text });
    if (this.logs.length > 500) this.logs.shift();
  }

  constructor(id: string) {
    this.id = id;
  }

  /** Initialize outputs with default mapping (output i → universe i+1). */
  protected initOutputs(count: number) {
    this.outputCount = count;
    this.outputMapping.value = Array.from({ length: count }, (_, i) => i + 1);
  }

  /** Set the universe for a specific output (0 = unassign). */
  setOutputUniverse(outputIndex: number, universe: number) {
    if (outputIndex < 0 || outputIndex >= this.outputCount) return;
    const mapping = [...this.outputMapping.value];
    mapping[outputIndex] = universe;
    this.outputMapping.value = mapping;
  }

  /** Get all universes this connector is currently outputting (non-zero entries). */
  getActiveUniverses(): number[] {
    return this.outputMapping.value.filter(u => u > 0);
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
