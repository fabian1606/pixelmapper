import { reactive, ref, type Ref } from 'vue';
import type {
  ControlFeedback,
  ControlInputEvent,
  ControllerStatus,
} from './types';

export interface ControllerLogLine {
  ts: number;
  text: string;
}

const MAX_LOGS = 200;

/**
 * Base class for hardware controller drivers (MIDI, HID, WebSerial, …).
 *
 * Reactive observable fields use `ref`/`reactive` so the UI re-renders on
 * status / log changes. Hardware handles (MIDIAccess, MIDIInput, MIDIOutput,
 * HIDDevice, …) MUST stay as plain private fields on subclasses — wrapping
 * them in Vue proxies breaks native event binding.
 */
export abstract class BaseControllerDriver {
  abstract readonly definitionKey: string;
  readonly id: string;

  status: Ref<ControllerStatus> = ref<ControllerStatus>('disconnected');
  errorMessage: Ref<string | null> = ref<string | null>(null);
  deviceLabel: Ref<string | null> = ref<string | null>(null);
  logs: ControllerLogLine[] = reactive<ControllerLogLine[]>([]);

  private listeners = new Set<(e: ControlInputEvent) => void>();

  constructor(id: string) {
    this.id = id;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendFeedback(fb: ControlFeedback): void;

  onInput(cb: (e: ControlInputEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected emitInput(e: ControlInputEvent) {
    for (const cb of this.listeners) cb(e);
  }

  protected pushLog(text: string) {
    this.logs.push({ ts: Date.now(), text });
    if (this.logs.length > MAX_LOGS) this.logs.shift();
  }
}
