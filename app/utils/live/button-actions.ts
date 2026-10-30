import { getPresetMainColor } from '~/utils/engine/preset-color';
import type { Preset } from '~/utils/engine/preset-types';
import type { SpeedConfig } from '~/utils/engine/types';
import { defaultButtonAction } from './types';
import type {
  ActionDuration,
  ButtonAction,
  ButtonAppearance,
  ButtonTrigger,
  HoldTime,
  LiveMapping,
  LiveSection,
  MidiTrigger,
  SectionTrigger,
} from './types';

/**
 * Pure rules for button actions (trigger → action → duration). Shared by the
 * sidebar (which options to show) and the runtime (how long things last).
 */

/** Second press within this window counts as a double press. */
export const DOUBLE_PRESS_MS = 300;

/** Hold time used when a long-press action has none set. */
export const DEFAULT_HOLD: HoldTime = { mode: 'time', ms: 1000 };

export const TRIGGER_LABELS: Record<ButtonTrigger, string> = {
  press: 'On press',
  double: 'On double press',
  long: 'On long press',
  hold: 'While pressing',
  release: 'On release',
  toggle: 'Toggle',
};

export const SECTION_TRIGGER_LABELS: Record<SectionTrigger, string> = {
  press: 'On press',
  hold: 'While pressing',
  toggle: 'Toggle',
};

/** New action as added by "+ Add Action": On press, nothing chosen yet. */
export function newButtonAction(): ButtonAction {
  return defaultButtonAction();
}

/** Trigger of a section (absent = press). */
export function sectionTrigger(section: LiveSection): SectionTrigger {
  return section.trigger ?? 'press';
}

/** Actions that happen once, instantly, and have nothing to end. */
export function isInstantAction(m: LiveMapping): boolean {
  if (m.type === 'page-switch' || m.type === 'position-recall') return true;
  return m.type === 'global-function' && (m.globalFunction === 'stop-all' || m.globalFunction === 'step-back');
}

/** A preset that switches the base preset (not a flash / overwrite preset). */
export function isNormalPreset(m: LiveMapping, presets: Preset[]): boolean {
  if (m.type !== 'preset' || !m.presetId) return false;
  const p = presets.find(x => x.id === m.presetId);
  return !p?.type || p.type === 'normal';
}

/**
 * Trigger an action gets when the user has not picked one: flash things are
 * "While pressing", the destructive "Stop all" needs a long press, the rest
 * fires on press.
 */
export function defaultTriggerFor(m: LiveMapping, presets: Preset[]): ButtonTrigger {
  if (m.type === 'global-function') {
    if (m.globalFunction === 'stop-all') return 'long';
    if (m.globalFunction === 'speed' || m.globalFunction === 'step-back') return 'press';
    return 'hold';
  }
  if (m.type === 'preset' && m.presetId) {
    const p = presets.find(x => x.id === m.presetId);
    return p?.type === 'flash' || p?.type === 'overwrite' ? 'hold' : 'press';
  }
  if (m.type === 'channel' || m.type === 'dimmer-group') return 'hold';
  return 'press';
}

/** Returns the action with a new mapping, following the smart default trigger until the user chose one. */
export function withMapping(a: ButtonAction, mapping: LiveMapping, presets: Preset[]): ButtonAction {
  const next: ButtonAction = { ...a, action: mapping };
  if (!a.triggerTouched) next.trigger = defaultTriggerFor(mapping, presets);
  return next;
}

/**
 * Duration modes the user can choose for an action. Empty = no duration
 * field at all (While pressing, Toggle, instant actions, no action yet).
 */
export function durationModesFor(a: ButtonAction): ActionDuration['mode'][] {
  if (a.trigger === 'hold' || a.trigger === 'toggle') return [];
  if (a.action.type === 'none' || isInstantAction(a.action)) return [];
  return a.action.type === 'preset' ? ['forever', 'beats', 'time', 'once'] : ['forever', 'beats', 'time'];
}

/** Effective duration: falls back to forever when the stored mode is not offered. */
export function effectiveDuration(a: ButtonAction): ActionDuration {
  const d = a.duration ?? { mode: 'forever' };
  return durationModesFor(a).includes(d.mode) ? d : { mode: 'forever' };
}

/** Milliseconds of one beat at `bpm` (0 bpm = frozen, treated as 120). */
export function beatMs(bpm: number): number {
  return 60000 / (bpm > 0 ? bpm : 120);
}

/** Hold time of a long-press action in ms. */
export function holdMs(a: ButtonAction, bpm: number): number {
  const h = a.hold ?? DEFAULT_HOLD;
  return h.mode === 'beats' ? h.beats * beatMs(bpm) : h.ms;
}

/** Length of one modifier cycle in ms (0 = frozen / infinite). */
export function cycleMs(speed: SpeedConfig, bpm: number): number {
  if (speed.mode === 'time') return Math.max(0, speed.timeMs);
  if (speed.mode === 'beat') return Math.max(0, speed.beatValue) * beatMs(bpm);
  return 0;
}

/**
 * Timed duration in ms, or null for forever. `passMs` is the length of one
 * pass of the preset (used by 'once').
 */
export function durationMs(d: ActionDuration, bpm: number, passMs: number): number | null {
  switch (d.mode) {
    case 'forever': return null;
    case 'beats': return d.beats * beatMs(bpm);
    case 'time': return d.ms;
    case 'once': return passMs;
  }
}

/** Defaults for the look of a button. */
export function resolveAppearance(ap: ButtonAppearance | undefined): Required<ButtonAppearance> {
  return { active: ap?.active ?? 'full', inactive: ap?.inactive ?? 'dim' };
}

/**
 * Brightness factor (0–1) of a button for its look, active state and time.
 * Used for the canvas color mix and the controller LED velocity.
 */
export function appearanceLevel(ap: ButtonAppearance | undefined, active: boolean, nowMs: number, bpm: number): number {
  const look = resolveAppearance(ap);
  if (active) {
    if (look.active === 'blink') return Math.floor(nowMs / 150) % 2 ? 1 : 0.25;
    if (look.active === 'pulse') return 0.45 + 0.55 * (0.5 + 0.5 * Math.cos((nowMs / beatMs(bpm)) * Math.PI * 2));
    return 1;
  }
  if (look.inactive === 'off') return 0;
  if (look.inactive === 'dim') return 0.35;
  return 1;
}

/** Looks that change over time and need a running animation frame. */
export function isAnimatedLook(ap: ButtonAppearance | undefined): boolean {
  return resolveAppearance(ap).active !== 'full';
}

/** Which trigger kinds a script uses, for the small badge on the canvas button. */
export function triggerBadge(actions: ButtonAction[] | undefined): string {
  const t = new Set((actions ?? []).filter(a => a.action.type !== 'none').map(a => a.trigger));
  let badge = '';
  if (t.has('hold')) badge += '⚡';
  if (t.has('toggle')) badge += '⇄';
  if (t.has('release')) badge += '↑';
  if (t.has('double')) badge += '2×';
  if (t.has('long')) badge += '⏳';
  return badge;
}

const GLOBAL_LABELS: Record<string, string> = {
  strobe: 'Strobe', blind: 'Blind', blackout: 'Blackout', speed: 'Speed', 'stop-all': 'Stop all', 'step-back': 'Step back',
};

/** Short name of one action, used for the auto label and the card summary. */
export function actionName(m: LiveMapping, presets: Preset[]): string | null {
  if (m.type === 'preset' && m.presetId) return presets.find(p => p.id === m.presetId)?.name ?? null;
  if (m.type === 'global-function' && m.globalFunction) {
    if (m.globalFunction === 'speed') {
      const mult = (m.globalFunctionConfig as { multiplier?: number } | undefined)?.multiplier ?? 1;
      return mult === 0 ? 'Freeze' : mult === 1 ? 'Reset 1×' : `${mult}×`;
    }
    return GLOBAL_LABELS[m.globalFunction] ?? m.globalFunction;
  }
  return null;
}

/** Label a button shows when it has no own label: the first action with a name. */
export function autoLabel(actions: ButtonAction[] | undefined, presets: Preset[]): string | null {
  for (const a of actions ?? []) {
    const name = actionName(a.action, presets);
    if (name) return name;
  }
  return null;
}

/** Color a button shows when it has no own color: the first preset action's main color. */
export function autoColor(actions: ButtonAction[] | undefined, presets: Preset[]): string | null {
  for (const a of actions ?? []) {
    if (a.action.type !== 'preset' || !a.action.presetId) continue;
    const p = presets.find(x => x.id === a.action.presetId);
    if (p) return getPresetMainColor(p);
  }
  return null;
}

/** Readable name of a key code: "KeyB" → "B", "Digit1" → "1", "ArrowUp" → "↑". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space' };
  return named[code] ?? code;
}

/** Readable name of a MIDI input: "Note 36 · Ch 1" / "CC 7 · Ch 10". */
export function midiLabel(m: MidiTrigger): string {
  return `${m.type === 'note' ? 'Note' : 'CC'} ${m.number} · Ch ${m.channel}`;
}

/**
 * Parses raw MIDI bytes into a button press / release, or null for anything
 * else. Note-on (velocity > 0) and CC > 0 press; note-off, note-on with
 * velocity 0 and CC 0 release (pads send CC 127 / 0).
 */
export function parseMidiInput(data: ArrayLike<number>): { message: MidiTrigger; down: boolean } | null {
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const number = data[1] ?? 0;
  const value = data[2] ?? 0;
  if (kind === 0x90) return { message: { type: 'note', channel, number }, down: value > 0 };
  if (kind === 0x80) return { message: { type: 'note', channel, number }, down: false };
  if (kind === 0xb0) return { message: { type: 'cc', channel, number }, down: value > 0 };
  return null;
}

/** Whether an incoming MIDI message is the one a button listens for. */
export function midiMatches(want: MidiTrigger | undefined, got: MidiTrigger): boolean {
  return !!want && want.type === got.type && want.channel === got.channel && want.number === got.number;
}
