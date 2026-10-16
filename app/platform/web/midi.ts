/**
 * Web MIDI implementation of the platform `MidiApi` (ADR 0003).
 *
 * Adapts `MIDIAccess` ports to the contract's plain port objects. Chromium
 * and Firefox only; `createWebMidi()` returns `null` elsewhere (Safari,
 * WKWebView).
 */
import type { MidiAccessHandle, MidiApi, MidiInputPort, MidiOutputPort, MidiStateChange } from '@pixelmapper/extension-api';

/** Wraps a Web MIDI input. */
function wrapInput(port: MIDIInput): MidiInputPort {
  return {
    id: port.id,
    name: port.name ?? '',
    manufacturer: port.manufacturer ?? '',
    onMessage(cb) {
      const listener = (e: Event) => {
        const data = (e as MIDIMessageEvent).data;
        if (data) cb(data);
      };
      port.addEventListener('midimessage', listener);
      return () => port.removeEventListener('midimessage', listener);
    },
  };
}

/** Wraps a Web MIDI output. */
function wrapOutput(port: MIDIOutput): MidiOutputPort {
  return {
    id: port.id,
    name: port.name ?? '',
    manufacturer: port.manufacturer ?? '',
    send: data => port.send(data),
  };
}

/** Wraps granted Web MIDI access. */
function wrapAccess(access: MIDIAccess): MidiAccessHandle {
  return {
    inputs: () => [...access.inputs.values()].map(wrapInput),
    outputs: () => [...access.outputs.values()].map(wrapOutput),
    onStateChange(cb) {
      const listener = (e: Event) => {
        const port = (e as MIDIConnectionEvent).port;
        if (!port) return;
        const change: MidiStateChange = {
          port: { id: port.id, name: port.name ?? '', manufacturer: port.manufacturer ?? '' },
          direction: port.type,
          state: port.state,
        };
        cb(change);
      };
      access.addEventListener('statechange', listener);
      return () => access.removeEventListener('statechange', listener);
    },
  };
}

/** Returns the Web MIDI `MidiApi`, or `null` when the browser has no Web MIDI. */
export function createWebMidi(): MidiApi | null {
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') return null;
  return {
    async requestAccess(options) {
      return wrapAccess(await navigator.requestMIDIAccess({ sysex: options?.sysex ?? false }));
    },
  };
}
