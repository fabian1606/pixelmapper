/**
 * Native MIDI for the Tauri platform (ADR 0003, step 3).
 *
 * WKWebView has no Web MIDI, so this calls the `midi_*` commands of
 * `src-tauri/src/midi.rs`. Port lists are cached (the contract's `inputs()` /
 * `outputs()` are synchronous) and refreshed by polling while someone listens
 * for hot-plug changes. Incoming messages stream over a Tauri channel;
 * outgoing ones are raw IPC bodies, sent one after another per port so LED
 * feedback keeps its order.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import type { MidiAccessHandle, MidiApi, MidiInputPort, MidiOutputPort, MidiPortInfo, MidiStateChange } from '@pixelmapper/extension-api';

/** How often the port list is re-read while hot-plug listeners exist. */
const POLL_INTERVAL_MS = 1000;

/** A port as listed by `midi_list`. */
interface NativePort {
  id: string;
  name: string;
}

/** Answer of `midi_list`. */
interface NativePortList {
  inputs: NativePort[];
  outputs: NativePort[];
}

/** Converts a native port to the contract's port info (CoreMIDI names only). */
function toInfo(port: NativePort): MidiPortInfo {
  return { id: port.id, name: port.name, manufacturer: '' };
}

/** Emits `connected`/`disconnected` changes between two lists of one direction. */
function diffPorts(
  prev: NativePort[],
  next: NativePort[],
  direction: MidiStateChange['direction'],
  emit: (change: MidiStateChange) => void,
) {
  const prevIds = new Set(prev.map(p => p.id));
  const nextIds = new Set(next.map(p => p.id));
  for (const p of prev) {
    if (!nextIds.has(p.id)) emit({ port: toInfo(p), direction, state: 'disconnected' });
  }
  for (const p of next) {
    if (!prevIds.has(p.id)) emit({ port: toInfo(p), direction, state: 'connected' });
  }
}

/** Creates the native `MidiApi`. Port cache, hot-plug polling and output connections are shared by all access handles. */
export function createTauriMidi(): MidiApi {
  let ports: NativePortList = { inputs: [], outputs: [] };
  const stateListeners = new Set<(change: MidiStateChange) => void>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let refreshing = false;
  /** Open output connection per port id, plus the tail of its send queue. */
  const outputs = new Map<string, { handle: Promise<number>; queue: Promise<void> }>();

  /** Closes the cached output connection of a port (vanished or failed). */
  function dropOutput(id: string) {
    const out = outputs.get(id);
    if (!out) return;
    outputs.delete(id);
    out.handle
      .then(handle => invoke('midi_close', { handle }))
      .catch(() => { /* the open itself failed; nothing to close */ });
  }

  /** Re-reads the port list and reports differences to the hot-plug listeners. */
  async function refresh() {
    const next = await invoke<NativePortList>('midi_list');
    const emit = (change: MidiStateChange) => {
      if (change.direction === 'output' && change.state === 'disconnected') dropOutput(change.port.id);
      for (const l of stateListeners) l(change);
    };
    const prev = ports;
    ports = next;
    diffPorts(prev.inputs, next.inputs, 'input', emit);
    diffPorts(prev.outputs, next.outputs, 'output', emit);
  }

  /** One polling step; skipped while the previous one is still running. */
  function poll() {
    if (refreshing) return;
    refreshing = true;
    refresh()
      .catch(e => console.warn('[midi] port refresh failed:', e))
      .finally(() => { refreshing = false; });
  }

  /** Wraps a native input; each subscription opens its own native connection. */
  function wrapInput(port: NativePort): MidiInputPort {
    return {
      ...toInfo(port),
      onMessage(cb) {
        let closed = false;
        const channel = new Channel<number[]>();
        channel.onmessage = (data) => {
          if (!closed) cb(Uint8Array.from(data));
        };
        const handle = invoke<number>('midi_open_input', { id: port.id, onMessage: channel })
          .catch((e: unknown) => {
            console.warn(`[midi] opening input ${port.name} failed:`, e);
            return null;
          });
        return () => {
          if (closed) return;
          closed = true;
          void handle.then(h => (h === null ? undefined : invoke('midi_close', { handle: h })))
            .catch((e: unknown) => console.warn('[midi] closing input failed:', e));
        };
      },
    };
  }

  /** Wraps a native output; the connection is opened on the first send and reused. */
  function wrapOutput(port: NativePort): MidiOutputPort {
    return {
      ...toInfo(port),
      send(data) {
        const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
        let out = outputs.get(port.id);
        if (!out) {
          out = { handle: invoke<number>('midi_open_output', { id: port.id }), queue: Promise.resolve() };
          outputs.set(port.id, out);
        }
        const current = out;
        // Chained so messages reach the device in call order.
        current.queue = current.queue
          .then(() => current.handle)
          .then(handle => invoke<void>('midi_send', bytes, { headers: { 'x-handle': String(handle) } }))
          .catch((e: unknown) => {
            // Reopen on the next send (e.g. the device was replugged); log once per connection.
            if (outputs.get(port.id) !== current) return;
            console.warn(`[midi] send to ${port.name} failed:`, e);
            dropOutput(port.id);
          });
      },
    };
  }

  const access: MidiAccessHandle = {
    inputs: () => ports.inputs.map(wrapInput),
    outputs: () => ports.outputs.map(wrapOutput),
    onStateChange(cb) {
      stateListeners.add(cb);
      pollTimer ??= setInterval(poll, POLL_INTERVAL_MS);
      return () => {
        stateListeners.delete(cb);
        if (stateListeners.size === 0 && pollTimer !== null) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    },
  };

  return {
    // Native MIDI needs no permission prompt; sysex is always allowed.
    async requestAccess() {
      await refresh();
      return access;
    },
  };
}
