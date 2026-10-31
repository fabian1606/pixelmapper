/**
 * Native MIDI of the Tauri platform: port listing, input channel, ordered
 * output sends and hot-plug polling over mocked `invoke`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MidiStateChange } from '@pixelmapper/extension-api';

const invoke = vi.fn();

/** Stand-in for Tauri's `Channel`: tests push messages via `onmessage`. */
class FakeChannel<T> {
  onmessage: (data: T) => void = () => {};
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: FakeChannel,
}));

const { createTauriMidi } = await import('./midi');

const APC = { id: '101', name: 'APC mini mk2 Control' };

/** Answers `midi_list` with the given ports and every other command with `handle`. */
function answer(list: { inputs: typeof APC[]; outputs: typeof APC[] }, handle = 5) {
  invoke.mockImplementation(async (cmd: string) => (cmd === 'midi_list' ? list : handle));
}

/** Lets pending promise chains settle. */
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tauri MIDI', () => {
  it('lists ports on access', async () => {
    answer({ inputs: [APC], outputs: [APC] });
    const access = await createTauriMidi().requestAccess({ sysex: true });
    expect(access.inputs()).toEqual([expect.objectContaining({ id: '101', name: APC.name, manufacturer: '' })]);
    expect(access.outputs()).toHaveLength(1);
  });

  it('streams input messages over a channel and closes the connection', async () => {
    answer({ inputs: [APC], outputs: [] }, 3);
    const access = await createTauriMidi().requestAccess();
    const got: number[][] = [];
    const off = access.inputs()[0]!.onMessage(d => got.push([...d]));

    const [, args] = invoke.mock.calls.find(c => c[0] === 'midi_open_input')!;
    expect(args.id).toBe('101');
    args.onMessage.onmessage([0x90, 1, 127]);
    expect(got).toEqual([[0x90, 1, 127]]);

    off();
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('midi_close', { handle: 3 });
    args.onMessage.onmessage([0x80, 1, 0]);
    expect(got).toHaveLength(1);
  });

  it('opens an output once and sends in order as raw bodies', async () => {
    answer({ inputs: [], outputs: [APC] }, 9);
    const access = await createTauriMidi().requestAccess();
    const out = access.outputs()[0]!;
    out.send([0x96, 100, 3]);
    out.send(new Uint8Array([0xf0, 0xf7]));
    await flush();

    const calls = invoke.mock.calls.filter(c => c[0] !== 'midi_list');
    expect(calls.filter(c => c[0] === 'midi_open_output')).toHaveLength(1);
    expect(calls.filter(c => c[0] === 'midi_send')).toEqual([
      ['midi_send', new Uint8Array([0x96, 100, 3]), { headers: { 'x-handle': '9' } }],
      ['midi_send', new Uint8Array([0xf0, 0xf7]), { headers: { 'x-handle': '9' } }],
    ]);
  });

  it('reports hot-plug changes while listeners exist', async () => {
    vi.useFakeTimers();
    answer({ inputs: [APC], outputs: [APC] });
    const access = await createTauriMidi().requestAccess();
    const changes: MidiStateChange[] = [];
    const off = access.onStateChange(c => changes.push(c));

    answer({ inputs: [], outputs: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes.map(c => `${c.direction}:${c.state}`)).toEqual(['input:disconnected', 'output:disconnected']);

    answer({ inputs: [APC], outputs: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes.at(-1)).toMatchObject({ direction: 'input', state: 'connected', port: { id: '101' } });

    off();
    invoke.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(invoke).not.toHaveBeenCalled();
  });
});
