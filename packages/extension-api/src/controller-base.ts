/**
 * Reusable base class for hardware controller drivers (MIDI, HID, Web
 * Serial…), ADR §5.7 / plan P6.4. Lives in the API package (depends on
 * `vue` only) so layers and bundles extend the same class.
 *
 * Hardware handles (MIDIAccess, MIDIInput, HIDDevice, …) MUST stay plain
 * private fields on subclasses — Vue proxies break native event binding.
 */
import { reactive, ref, type Ref } from 'vue';
import type { ConnectorStatus, ControlFeedback, ControlInputEvent, ControllerDriver, LogLine } from './connectors';

/** Maximum log lines kept per driver. */
const MAX_LOG_LINES = 200;

export abstract class ControllerDriverBase implements ControllerDriver {
  abstract readonly definitionKey: string;
  readonly id: string;

  status: Ref<ConnectorStatus> = ref<ConnectorStatus>('disconnected');
  errorMessage: Ref<string | null> = ref<string | null>(null);
  deviceLabel: Ref<string | null> = ref<string | null>(null);
  logs: LogLine[] = reactive([]);

  private listeners = new Set<(e: ControlInputEvent) => void>();

  constructor(id: string) {
    this.id = id;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendFeedback(fb: ControlFeedback): void;

  /** Subscribes to input events; returns an unsubscribe function. */
  onInput(cb: (e: ControlInputEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Delivers an input event to all listeners. */
  protected emitInput(e: ControlInputEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  /** Appends a log line (bounded). */
  protected pushLog(text: string): void {
    this.logs.push({ ts: Date.now(), text });
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }
}
