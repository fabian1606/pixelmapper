import { createPlatform } from '#platform';
import type { MidiApi } from '@pixelmapper/extension-api';

/**
 * Shared MIDI input for button triggers ("On MIDI trigger") and MIDI learn.
 * Listens on every input port (hot-plug aware) and fans raw messages out to
 * subscribers. Access is requested lazily on the first subscription, so the
 * browser only asks for MIDI permission once something actually needs it.
 */

type Listener = (data: Uint8Array) => void;

const listeners = new Set<Listener>();
const portOffs = new Map<string, () => void>();
let starting: Promise<void> | null = null;
let midiApi: MidiApi | null | undefined;

/** Platform MIDI (Web MIDI in browsers, native in the desktop app; null in Safari). */
function platformMidi(): MidiApi | null {
  if (midiApi === undefined) midiApi = createPlatform().midi;
  return midiApi;
}

/** Whether MIDI input is possible on this platform at all. */
export function isMidiAvailable(): boolean {
  return platformMidi() !== null;
}

function dispatch(data: Uint8Array) {
  for (const l of listeners) l(data);
}

async function start(): Promise<void> {
  const midi = platformMidi();
  if (!midi) return;
  const access = await midi.requestAccess();
  const attachInputs = () => {
    for (const port of access.inputs()) {
      if (!portOffs.has(port.id)) portOffs.set(port.id, port.onMessage(dispatch));
    }
  };
  attachInputs();
  access.onStateChange((change) => {
    if (change.direction !== 'input') return;
    if (change.state === 'connected') attachInputs();
    else {
      portOffs.get(change.port.id)?.();
      portOffs.delete(change.port.id);
    }
  });
}

/** Subscribes to raw MIDI input from all ports; returns the unsubscribe function. */
export function onMidiInput(cb: Listener): () => void {
  listeners.add(cb);
  starting ??= start().catch((e) => {
    console.warn('[midi] input unavailable', e);
    starting = null;
  });
  return () => { listeners.delete(cb); };
}
