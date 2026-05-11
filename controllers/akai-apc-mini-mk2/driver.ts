import { BaseControllerDriver } from '~/utils/controllers/base-controller-driver';
import type { ControlFeedback, ControlInputEvent } from '~/utils/controllers/types';

/**
 * AKAI APC Mini mk2 driver (Web MIDI).
 *
 * Control id conventions (must match the manifest):
 *   pad-<row>-<col>   r=0..7 (0 = bottom row), c=0..7 (0 = left col)  → notes  0..63
 *   track-<i>         i=0..7  → notes 100..107  (single-color row above pads)
 *   scene-<i>         i=0..7  → notes 112..119  (single-color column on the right)
 *   shift             → note 122
 *   fader-<i>         i=0..8  (0..7 = channel faders, 8 = master)  → CC 48..56
 *
 * LED feedback:
 *   Pads (RGB): sysex F0 47 7F 4F 24 LL HH [pad, r, g, b]... F7
 *               (LL HH = payload byte count, LSB first)
 *   Track / Scene (single-color): note_on with velocity 0 (off) or 1 (on).
 */

const VENDOR_REGEX = /APC mini mk2/i;

// Pad: row (0 = bottom) and col → MIDI note number 0..63
function noteForPad(row: number, col: number): number {
  return row * 8 + col;
}
function padFromNote(note: number): { row: number; col: number } | null {
  if (note < 0 || note > 63) return null;
  return { row: Math.floor(note / 8), col: note % 8 };
}

const TRACK_NOTE_BASE = 100;
const SCENE_NOTE_BASE = 112;
const SHIFT_NOTE = 122;
const FADER_CC_BASE = 48;
const FADER_COUNT = 9;

export class APCMiniMk2Driver extends BaseControllerDriver {
  readonly definitionKey = 'akai-apc-mini-mk2';

  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private onStateChangeBound: ((e: Event) => void) | null = null;
  private onMidiMessageBound: ((e: Event) => void) | null = null;

  /** Diff cache so we don't spam the device with identical LED writes. */
  private lastFeedback = new Map<string, string>();

  async connect(): Promise<void> {
    if (this.status.value === 'connected' || this.status.value === 'connecting') return;
    this.status.value = 'connecting';
    this.errorMessage.value = null;
    try {
      // Sysex required for RGB pad colors. Triggers the browser permission prompt
      // on first call per origin (must be invoked from a user gesture).
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (err) {
      this.status.value = 'error';
      this.errorMessage.value = (err as Error).message ?? 'MIDI access denied';
      this.pushLog(`MIDI access denied: ${this.errorMessage.value}`);
      return;
    }

    const input = this.findPort(this.access.inputs.values()) as MIDIInput | null;
    const output = this.findPort(this.access.outputs.values()) as MIDIOutput | null;

    if (!input || !output) {
      this.status.value = 'error';
      this.errorMessage.value = 'APC Mini mk2 not found. Plug in the device and try again.';
      this.pushLog(this.errorMessage.value);
      return;
    }

    this.input = input;
    this.output = output;
    this.deviceLabel.value = input.name ?? 'APC Mini mk2';

    this.onMidiMessageBound = (e) => this.handleMidiMessage(e as MIDIMessageEvent);
    this.input.addEventListener('midimessage', this.onMidiMessageBound);

    this.onStateChangeBound = (e) => this.handleStateChange(e as MIDIConnectionEvent);
    this.access.addEventListener('statechange', this.onStateChangeBound);

    this.status.value = 'connected';
    this.pushLog(`Connected to ${this.deviceLabel.value}`);
  }

  async disconnect(): Promise<void> {
    if (this.input && this.onMidiMessageBound) {
      this.input.removeEventListener('midimessage', this.onMidiMessageBound);
    }
    if (this.access && this.onStateChangeBound) {
      this.access.removeEventListener('statechange', this.onStateChangeBound);
    }
    this.input = null;
    this.output = null;
    this.access = null;
    this.onMidiMessageBound = null;
    this.onStateChangeBound = null;
    this.lastFeedback.clear();
    this.status.value = 'disconnected';
    this.deviceLabel.value = null;
  }

  sendFeedback(fb: ControlFeedback): void {
    if (!this.output) return;

    const cacheKey = this.feedbackKey(fb);
    if (this.lastFeedback.get(fb.controlId) === cacheKey) return;
    this.lastFeedback.set(fb.controlId, cacheKey);

    if (fb.controlId.startsWith('pad-')) {
      const m = /^pad-(\d+)-(\d+)$/.exec(fb.controlId);
      if (!m) return;
      const note = noteForPad(parseInt(m[1], 10), parseInt(m[2], 10));
      this.sendPadFeedback(note, fb);
    } else if (fb.controlId.startsWith('track-')) {
      const i = parseInt(fb.controlId.slice('track-'.length), 10);
      if (Number.isFinite(i)) this.sendSingleColorNote(TRACK_NOTE_BASE + i, fb.state !== 'off');
    } else if (fb.controlId.startsWith('scene-')) {
      const i = parseInt(fb.controlId.slice('scene-'.length), 10);
      if (Number.isFinite(i)) this.sendSingleColorNote(SCENE_NOTE_BASE + i, fb.state !== 'off');
    } else if (fb.controlId === 'shift') {
      this.sendSingleColorNote(SHIFT_NOTE, fb.state !== 'off');
    }
  }

  // ── MIDI message handling ────────────────────────────────────────────────

  private handleMidiMessage(e: MIDIMessageEvent) {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;

    if (status === 0x90) {
      // Note On — velocity 0 means release on some devices
      const note = data[1];
      const velocity = data[2] ?? 0;
      const ev = this.eventForNote(note, velocity > 0 ? 'press' : 'release', velocity / 127);
      if (ev) this.emitInput(ev);
    } else if (status === 0x80) {
      // Note Off
      const note = data[1];
      const ev = this.eventForNote(note, 'release', 0);
      if (ev) this.emitInput(ev);
    } else if (status === 0xb0) {
      // Control Change
      const cc = data[1];
      const value = data[2] ?? 0;
      const ev = this.eventForCc(cc, value);
      if (ev) this.emitInput(ev);
    }
  }

  private eventForNote(note: number, type: 'press' | 'release', value: number): ControlInputEvent | null {
    const pad = padFromNote(note);
    if (pad) {
      return { controlId: `pad-${pad.row}-${pad.col}`, type, value };
    }
    if (note >= TRACK_NOTE_BASE && note < TRACK_NOTE_BASE + 8) {
      return { controlId: `track-${note - TRACK_NOTE_BASE}`, type, value };
    }
    if (note >= SCENE_NOTE_BASE && note < SCENE_NOTE_BASE + 8) {
      return { controlId: `scene-${note - SCENE_NOTE_BASE}`, type, value };
    }
    if (note === SHIFT_NOTE) {
      return { controlId: 'shift', type, value };
    }
    return null;
  }

  private eventForCc(cc: number, value: number): ControlInputEvent | null {
    if (cc >= FADER_CC_BASE && cc < FADER_CC_BASE + FADER_COUNT) {
      return { controlId: `fader-${cc - FADER_CC_BASE}`, type: 'value', value: value / 127 };
    }
    return null;
  }

  // ── LED writes ───────────────────────────────────────────────────────────

  private sendPadFeedback(note: number, fb: ControlFeedback) {
    if (!this.output) return;
    let r = 0, g = 0, b = 0;
    if (fb.state === 'off') {
      r = 0; g = 0; b = 0;
    } else if (fb.state === 'on') {
      r = 255; g = 255; b = 255;
    } else if (typeof fb.state === 'object' && fb.state.type === 'rgb') {
      r = clamp7(fb.state.r); g = clamp7(fb.state.g); b = clamp7(fb.state.b);
    }
    // Sysex header: F0 47 7F 4F 24 LL HH <payload> F7
    // Payload per pad: <pad>, <r MSB>, <r LSB>, <g MSB>, <g LSB>, <b MSB>, <b LSB>
    // The mk2 spec uses 14-bit color (two bytes per channel, MSB first in 7-bit chunks).
    // Here we simply repeat the 8-bit value in both bytes (close enough for v1).
    const payload: number[] = [
      note,
      (r >> 7) & 0x7f, r & 0x7f,
      (g >> 7) & 0x7f, g & 0x7f,
      (b >> 7) & 0x7f, b & 0x7f,
    ];
    const len = payload.length;
    const sysex = [
      0xf0, 0x47, 0x7f, 0x4f, 0x24,
      len & 0x7f, (len >> 7) & 0x7f,
      ...payload,
      0xf7,
    ];
    try { this.output.send(sysex); } catch (e) { /* ignore */ }
  }

  private sendSingleColorNote(note: number, on: boolean) {
    if (!this.output) return;
    try { this.output.send([0x90, note, on ? 1 : 0]); } catch (e) { /* ignore */ }
  }

  private feedbackKey(fb: ControlFeedback): string {
    if (fb.state === 'on' || fb.state === 'off') return fb.state;
    return `rgb:${fb.state.r},${fb.state.g},${fb.state.b}`;
  }

  // ── Hot plug/unplug ──────────────────────────────────────────────────────

  private handleStateChange(e: MIDIConnectionEvent) {
    const port = e.port;
    if (!port) return;
    if (port.state === 'disconnected' && (port === this.input || port === this.output)) {
      this.pushLog(`Device disconnected: ${port.name}`);
      this.status.value = 'disconnected';
      this.input = null;
      this.output = null;
    }
  }

  private findPort(iter: IterableIterator<MIDIInput | MIDIOutput>): MIDIInput | MIDIOutput | null {
    for (const port of iter) {
      if (port.name && VENDOR_REGEX.test(port.name)) return port;
    }
    return null;
  }
}

function clamp7(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

export function driverFactory(id: string): APCMiniMk2Driver {
  return new APCMiniMk2Driver(id);
}
