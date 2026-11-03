import type { InputBinding } from '~/utils/live/types';

/**
 * Contract of an input source: anything that can press a live button (the
 * computer keyboard, MIDI, later Stream Deck, OSC, …). The button panel only
 * knows "Learn" and a list of bindings; play mode only knows "a binding went
 * down / up". Everything source-specific lives behind this interface.
 */

/** `learn`: the button panel waits for one input. `play`: inputs press buttons. */
export type InputListenMode = 'learn' | 'play';

/** One press or release coming from a source. */
export interface InputSignal {
  binding: InputBinding;
  down: boolean;
  /**
   * Name of the controller that owns where this came from (e.g. a MIDI port
   * an APC Mini twin claims). Owned input belongs to that twin: play mode
   * ignores it and Learn refuses it.
   */
  ownedBy?: string;
}

/**
 * Receives signals. Return `true` when the signal was used, so the source
 * can swallow the native event (e.g. `preventDefault` on a key).
 */
export type InputSignalHandler = (signal: InputSignal) => boolean | void;

export interface InputSource {
  /** Stored in `InputBinding.source`; never rename. */
  id: string;
  /** Short name shown with each binding, e.g. "Key", "MIDI". */
  title: string;
  /** Learn prompt fragment, e.g. "press a key". */
  learnHint: string;
  /** Whether the source works here (MIDI is missing in Safari). */
  isAvailable(): boolean;
  /** Readable address, e.g. "B" or "Note 36 · Ch 1". */
  format(address: unknown): string;
  /** Starts listening; returns the stop function. Opens devices lazily. */
  listen(mode: InputListenMode, handler: InputSignalHandler): () => void;
}
