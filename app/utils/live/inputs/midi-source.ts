import { isMidiAvailable, midiSourceOwner, onMidiInput } from '~/composables/live-ops/midi-input';
import { midiLabel, parseMidiInput } from '~/utils/live/button-actions';
import type { MidiTrigger } from '~/utils/live/types';
import type { InputSource } from './types';

/**
 * MIDI notes / CCs from any input port as an input source. Address: a
 * `MidiTrigger`. Messages from ports a controller claims (its `matches`)
 * carry `ownedBy`, since they belong to that controller's twin.
 */
export const midiInputSource: InputSource = {
  id: 'midi',
  title: 'MIDI',
  learnHint: 'play a note',
  isAvailable: isMidiAvailable,
  format: address => midiLabel(address as MidiTrigger),

  listen(_mode, handler) {
    // Same for learn and play; MIDI access is only requested on first listen.
    return onMidiInput((data, port) => {
      const msg = parseMidiInput(data);
      if (!msg) return;
      handler({
        binding: { source: 'midi', address: msg.message },
        down: msg.down,
        ownedBy: midiSourceOwner(port)?.label,
      });
    });
  },
};
