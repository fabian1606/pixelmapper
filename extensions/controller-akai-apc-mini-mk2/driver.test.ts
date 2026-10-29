/**
 * APC Mini mk2 driver on the platform MIDI contract (ADR 0003): input
 * mapping, LED feedback, unplug, and the no-MIDI message.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MidiApi, MidiStateChange, Platform, SharedGlobals } from '@pixelmapper/extension-api';
import { APCMiniMk2Driver } from './driver';

/** Installs a host stub that only provides `platform`. */
function stubPlatform(midi: MidiApi | null) {
  const platform: Platform = { kind: 'web', serial: null, midi, artnetBridge: null };
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { platform } as unknown as SharedGlobals['api'] };
}

/** Fake MIDI with one APC input/output; exposes hooks to inject messages and state changes. */
function fakeMidi() {
  let onMessage: ((d: Uint8Array) => void) | null = null;
  let onState: ((c: MidiStateChange) => void) | null = null;
  const sent: number[][] = [];
  const api: MidiApi = {
    requestAccess: async () => ({
      inputs: () => [{ id: 'in', name: 'APC mini mk2 Control', manufacturer: 'AKAI', onMessage: (cb) => { onMessage = cb; return () => { onMessage = null; }; } }],
      outputs: () => [{ id: 'out', name: 'APC mini mk2 Control', manufacturer: 'AKAI', send: d => sent.push([...d]) }],
      onStateChange: (cb) => { onState = cb; return () => { onState = null; }; },
    }),
  };
  return {
    api,
    sent,
    message: (...bytes: number[]) => onMessage?.(new Uint8Array(bytes)),
    state: (c: MidiStateChange) => onState?.(c),
    get listening() { return !!onMessage; },
  };
}

afterEach(() => {
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
});

describe('APCMiniMk2Driver', () => {
  it('maps pads and faders to control events', async () => {
    const midi = fakeMidi();
    stubPlatform(midi.api);
    const d = new APCMiniMk2Driver('d1');
    const events: unknown[] = [];
    d.onInput(e => events.push(e));
    await d.connect();
    expect(d.status.value).toBe('connected');

    midi.message(0x90, 9, 127); // pad row 1, col 1
    midi.message(0xb0, 56, 127); // master fader
    expect(events).toEqual([
      { controlId: 'pad-1-1', type: 'press', value: 1 },
      { controlId: 'fader-8', type: 'value', value: 1 },
    ]);
  });

  it('sends LED feedback as note / sysex', async () => {
    const midi = fakeMidi();
    stubPlatform(midi.api);
    const d = new APCMiniMk2Driver('d2');
    await d.connect();
    d.sendFeedback({ controlId: 'scene-0', state: 'on' });
    d.sendFeedback({ controlId: 'pad-0-0', state: { type: 'rgb', r: 255, g: 0, b: 0 } });
    expect(midi.sent[0]).toEqual([0x96, 112, 3]);
    expect(midi.sent[1]!.slice(0, 11)).toEqual([0xf0, 0x47, 0x7f, 0x4f, 0x24, 0x00, 0x08, 0, 0, 1, 0x7f]);
  });

  it('goes disconnected when its port is unplugged', async () => {
    const midi = fakeMidi();
    stubPlatform(midi.api);
    const d = new APCMiniMk2Driver('d3');
    await d.connect();
    midi.state({ port: { id: 'in', name: 'APC mini mk2 Control', manufacturer: 'AKAI' }, direction: 'input', state: 'disconnected' });
    expect(d.status.value).toBe('disconnected');
    expect(midi.listening).toBe(false);
  });

  it('explains when the platform has no MIDI', async () => {
    stubPlatform(null);
    const d = new APCMiniMk2Driver('d4');
    await d.connect();
    expect(d.status.value).toBe('error');
    expect(d.errorMessage.value).toMatch(/desktop app/);
  });
});
