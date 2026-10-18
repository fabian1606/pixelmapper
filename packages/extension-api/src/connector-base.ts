/**
 * Reusable base class for connectors (ADR §5.7, plan P6.1).
 *
 * Lives in the API package (depends on `vue` only), so layer extensions and
 * distribution bundles (where this package is the shared host module) extend
 * the same class. Connectors send rendered output; they never render.
 */
import { reactive, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { Connector, ConnectorEngineState, ConnectorStatus, LogLine } from './connectors';

/** Maximum log lines kept per connector. */
const MAX_LOG_LINES = 500;

export abstract class ConnectorBase implements Connector {
  readonly id: string;
  abstract readonly meta: { readonly type: string; readonly label: string; readonly icon?: string };

  status: Ref<ConnectorStatus> = ref<ConnectorStatus>('disconnected');
  errorMessage: Ref<string | null> = ref<string | null>(null);
  logs: LogLine[] = reactive([]);
  /** User-visible name of this instance. */
  label: Ref<string> = ref('');

  /**
   * Armed after the first successful connection; a drop then retries until
   * `disconnect()`. Session state only.
   */
  autoReconnect: Ref<boolean> = ref(false);

  /** Number of physical DMX outputs (0 = no direct DMX output, uses `onEngineState`). */
  outputCount = 0;

  /** `outputMapping[i]` = universe of output `i` (0 = unassigned). */
  outputMapping: ShallowRef<number[]> = shallowRef<number[]>([]);

  constructor(id: string) {
    this.id = id;
  }

  /** Appends a log line (bounded). */
  protected pushLog(text: string): void {
    this.logs.push({ ts: Date.now(), text });
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  /** Sets `count` outputs with the default mapping output i → universe i+1. */
  protected initOutputs(count: number): void {
    this.outputCount = count;
    this.outputMapping.value = Array.from({ length: count }, (_, i) => i + 1);
  }

  /** Resizes the outputs, keeping existing mappings. */
  setOutputCount(n: number): void {
    const count = Math.max(0, Math.min(64, Math.floor(n)));
    const prev = this.outputMapping.value;
    this.outputCount = count;
    this.outputMapping.value = Array.from({ length: count }, (_, i) => prev[i] ?? i + 1);
  }

  /** Sets the universe of one output (0 = unassigned). */
  setOutputUniverse(outputIndex: number, universe: number): void {
    if (outputIndex < 0 || outputIndex >= this.outputCount) return;
    const mapping = [...this.outputMapping.value];
    mapping[outputIndex] = universe;
    this.outputMapping.value = mapping;
  }

  /** Universes currently output (non-zero mappings). */
  getActiveUniverses(): number[] {
    return this.outputMapping.value.filter(u => u > 0);
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  /**
   * One universe per active output per frame (outputCount > 0). MUST be
   * non-blocking (fire-and-forget writes).
   */
  sendFrame(_dmxBuffer: Uint8Array, _universe?: number): void {}

  /** Every frame while connected, for connectors without DMX outputs. */
  onEngineState?(state: ConnectorEngineState): void;

  /** True when the host may connect this instance on startup without a user gesture. */
  canAutoConnect(): boolean {
    return false;
  }

  /** True when the user never connects/disconnects this instance (see `Connector.alwaysConnected`). */
  alwaysConnected(): boolean {
    return false;
  }

  /** Serializable per-device configuration (`label` and outputs included). */
  getConfig(): Record<string, unknown> {
    return { label: this.label.value, outputCount: this.outputCount, outputMapping: this.outputMapping.value.slice() };
  }

  /**
   * Applies (a part of) a stored config to this instance. Subclasses extend
   * it and call `super.applyConfig(config)`. Keys absent from `config` stay.
   */
  applyConfig(config: Record<string, unknown>): void {
    if (typeof config.label === 'string') this.label.value = config.label;
    if (typeof config.outputCount === 'number') this.setOutputCount(config.outputCount);
    if (Array.isArray(config.outputMapping)) this.outputMapping.value = (config.outputMapping as number[]).slice(0, this.outputCount);
  }
}
