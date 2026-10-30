/**
 * Button scripts for the `live.*` operations.
 *
 * Live buttons no longer use `LiveWidget.mapping`: they run a script of
 * {@link ButtonAction}s (trigger → action → duration, see
 * `utils/live/button-actions.ts` and `composables/live-ops/button-runtime.ts`),
 * plus an `appearance` and outside `inputs` (keyboard / MIDI).
 *
 * This module gives agents:
 * - input schemas for actions / appearance / inputs (actions reuse the
 *   friendly mapping shape of `live-mapping.ts`: `modifierId`, bare param key);
 * - `mappingToButtonAction`: the convenience path — a single `mapping` on a
 *   button becomes one action whose trigger matches what the runtime needs
 *   (trigger params and bool params need press *and* release edges);
 * - `buttonActionFindings`: postconditions (entities exist, the button can
 *   drive the param, the trigger delivers the edges the target needs);
 * - views in the agent vocabulary (`fromButtonAction`, `actionsSummary`).
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import { getManifest } from '~/utils/plugins/plugin-store';
import { isTriggerParam } from '~/utils/plugins/trigger-param';
import { defaultTriggerFor, durationModesFor, withMapping } from '~/utils/live/button-actions';
import { defaultButtonAction, type ButtonAction, type ButtonAppearance, type ButtonInputs, type LiveMapping } from '~/utils/live/types';
import { DEFAULT_BUTTON_BEHAVIOR, paramTypeOfValue } from '~/utils/live/control-param-value';
import type { Preset } from '~/utils/engine/preset-types';
import type { CoreReadApi } from '../read-api';
import { LiveMappingInputSchema, fromLiveMapping, mappingFindings, mappingSummary, toLiveMapping } from './live-mapping';

// ── Schemas ─────────────────────────────────────

/** When an action fires. */
export const ButtonTriggerSchema = z.enum(['press', 'double', 'long', 'hold', 'release', 'toggle']).describe([
  'When the action fires: "press" (on press), "double" (second press within 300 ms), "long" (after holding `hold`, default 1 s),',
  '"hold" (runs while the button is held, stops on release), "release" (on release), "toggle" (first press starts it, next press stops it).',
].join(' '));

/** How long a fired action lasts. */
const DurationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('forever') }),
  z.object({ mode: z.literal('beats'), beats: z.number().positive() }),
  z.object({ mode: z.literal('time'), ms: z.number().positive() }),
  z.object({ mode: z.literal('once') }).describe('One pass of the preset\'s slowest modifier (presets only).'),
]).describe('How long a press/double/long/release action lasts (default forever). Ignored for hold/toggle and instant actions (page switch, position recall, stop-all).');

/** Hold time of a long press. */
const HoldSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('beats'), beats: z.number().positive() }),
  z.object({ mode: z.literal('time'), ms: z.number().positive() }),
]).describe('How long a "long" press must be held (default 1000 ms).');

/** One action of a button script (agent shape). */
export const ButtonActionInputSchema = z.object({
  id: z.string().min(1).optional().describe('Action id (default: generated).'),
  trigger: ButtonTriggerSchema,
  action: LiveMappingInputSchema.describe('What the action does (same shape as `mapping`).'),
  duration: DurationSchema.optional(),
  hold: HoldSchema.optional(),
}).describe('One step of a button script: trigger → action → duration.');

/** Agent-facing action type. */
export type ButtonActionInput = z.infer<typeof ButtonActionInputSchema>;

/** Look of a button (and its controller LED). */
export const ButtonAppearanceSchema = z.object({
  active: z.enum(['full', 'blink', 'pulse']).optional().describe('Look while active (default full).'),
  inactive: z.enum(['dim', 'off', 'full']).optional().describe('Look while inactive (default dim).'),
}).describe('Button look while active / inactive.');

/** Keyboard / MIDI inputs that press a button. */
export const ButtonInputsSchema = z.object({
  key: z.string().min(1).optional().describe('KeyboardEvent.code, e.g. "KeyB", "Digit1", "Space". Key down presses, key up releases.'),
  midi: z.object({
    type: z.enum(['note', 'cc']),
    channel: z.number().int().min(1).max(16).describe('MIDI channel 1–16.'),
    number: z.number().int().min(0).max(127).describe('Note or controller number 0–127.'),
  }).optional().describe('MIDI note / CC (any input port): note-on or CC > 0 presses, note-off or CC 0 releases.'),
}).describe('Outside inputs that press the button like a click.');

/** Explanation shared by the operation descriptions. */
export const BUTTON_ACTIONS_DOC = [
  'Buttons run a script of actions (field `actions`, button widgets only): [{ trigger, action, duration?, hold? }], action = a mapping (see Mappings).',
  '  Triggers: press | double | long | hold (while held) | release | toggle (press on, press off). Duration (press/double/long/release): forever (default) | { mode: "beats", beats } | { mode: "time", ms } | once (presets).',
  '  A single `mapping` on a button is the shortcut for one action with a fitting trigger: trigger param → "hold" (press + release edge),',
  '  bool param "latch" → "toggle", bool "hold" → "hold", speed with behavior "hold" → "hold", otherwise the UI default',
  '  (flash/overwrite presets, strobe/blind/blackout, channel, dimmer-group → "hold"; stop-all → "long"; the rest → "press").',
  '  `appearance` { active: full|blink|pulse, inactive: dim|off|full } and `inputs` { key: "KeyB", midi: { type: note|cc, channel, number } } are buttons only.',
].join('\n');

// ── Translation ─────────────────────────────────

/** Saved presets as the shape `defaultTriggerFor` reads (it only looks at id and type). */
function presetsOf(read: CoreReadApi): Preset[] {
  return read.presets() as unknown as Preset[];
}

/** What an `effect-param` mapping targets on a button: a trigger param, a bool param, or something else. */
function effectParamKind(read: CoreReadApi, m: LiveMapping): 'trigger' | 'bool' | null {
  if (m.type !== 'effect-param' || !m.effectId || !m.paramKey?.startsWith('params.')) return null;
  const modifier = read.modifier(m.effectId);
  if (!modifier) return null;
  const key = m.paramKey.slice('params.'.length);
  const manifest = getManifest(modifier.plugin);
  if (isTriggerParam(manifest, key)) return 'trigger';
  const type = manifest?.params.find(p => p.key === key)?.type ?? paramTypeOfValue(modifier.params[key]);
  return type === 'bool' ? 'bool' : null;
}

/**
 * Turns one stored mapping into a button action with a trigger the runtime
 * can honour:
 * - trigger param → "hold": the runtime starts the action on press (press
 *   edge) and stops it on release (release edge); "press" would never release.
 * - bool param → "toggle" (behavior latch, default) or "hold" (behavior
 *   hold). The stored behavior becomes "hold" in both cases: inside a script
 *   the param follows the action (true while it runs), the trigger decides
 *   when it runs. A latch bool on a toggle trigger would never switch off.
 * - speed with config behavior "hold" → "hold" (stopping resets to 1×).
 * - everything else (presets, global functions, channels, …) → the smart
 *   default trigger the sidebar uses (`withMapping` / `defaultTriggerFor`).
 */
export function mappingToButtonAction(read: CoreReadApi, mapping: LiveMapping): ButtonAction {
  const presets = presetsOf(read);
  const base = withMapping(defaultButtonAction(), mapping, presets);
  const kind = effectParamKind(read, mapping);
  let action: ButtonAction = base;
  if (kind === 'trigger') action = { ...base, trigger: 'hold' };
  else if (kind === 'bool') {
    const latch = (mapping.behavior ?? DEFAULT_BUTTON_BEHAVIOR) === 'latch';
    action = { ...base, trigger: latch ? 'toggle' : 'hold', action: { ...mapping, behavior: 'hold' } };
  } else if (mapping.type === 'global-function' && mapping.globalFunction === 'speed'
    && (mapping.globalFunctionConfig as { behavior?: string } | undefined)?.behavior === 'hold') {
    action = { ...base, trigger: 'hold' };
  }
  // Pin the trigger when it differs from the sidebar's smart default, so editing the action keeps it.
  if (action.trigger !== defaultTriggerFor(action.action, presets)) action.triggerTouched = true;
  return action;
}

/** Translates agent actions into stored actions (explicit triggers are pinned). */
export function toButtonActions(read: CoreReadApi, input: ButtonActionInput[]): ButtonAction[] {
  return input.map((a) => {
    const out: ButtonAction = {
      id: a.id ?? crypto.randomUUID(),
      trigger: a.trigger,
      action: toLiveMapping(read, a.action),
      triggerTouched: true,
    };
    if (a.duration) out.duration = a.duration;
    if (a.hold) out.hold = a.hold;
    return out;
  });
}

/** Stored appearance from the input (drops absent fields). */
export function toAppearance(input: z.infer<typeof ButtonAppearanceSchema>): ButtonAppearance {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as ButtonAppearance;
}

/** Stored inputs from the input (drops absent fields). */
export function toInputs(input: z.infer<typeof ButtonInputsSchema>): ButtonInputs {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as ButtonInputs;
}

// ── Views ───────────────────────────────────────

/** A stored action in the agent vocabulary (input shape of `actions`). */
export function fromButtonAction(a: ButtonAction): Record<string, unknown> {
  return {
    id: a.id,
    trigger: a.trigger,
    action: fromLiveMapping(a.action),
    ...(a.duration ? { duration: a.duration } : {}),
    ...(a.hold ? { hold: a.hold } : {}),
  };
}

/** One-line summary of a script, e.g. "hold → effect-param: modifier m1 → hit". */
export function actionsSummary(actions: ButtonAction[] | undefined): string {
  const parts = (actions ?? []).filter(a => a.action.type !== 'none').map(a => `${a.trigger} → ${mappingSummary(a.action)}`);
  return parts.length ? parts.join('; ') : 'none';
}

// ── Validation ──────────────────────────────────

/** Finding about one action of a button. */
function actionFinding(level: Finding['level'], code: string, message: string, widgetId: string): Finding {
  return { level, code, message, entityIds: [`liveWidget:${widgetId}`] };
}

/**
 * Checks that a trigger delivers the edges its target needs: a trigger param
 * fired "forever" is pressed and never released; a latch bool never turns
 * off on a hold / toggle trigger (release does not change a latch).
 */
function triggerFindings(read: CoreReadApi, a: ButtonAction, where: string, widgetId: string): Finding[] {
  const kind = effectParamKind(read, a.action);
  const oneShot = a.trigger === 'press' || a.trigger === 'double' || a.trigger === 'long' || a.trigger === 'release';
  const forever = (a.duration?.mode ?? 'forever') === 'forever';
  if (kind === 'trigger' && oneShot && forever) {
    return [actionFinding('warning', 'trigger-never-released',
      `${where}: a "${a.trigger}" action on trigger param "${presentKey(a.action)}" presses it and never releases it; use trigger "hold" (press + release edge) or a timed duration`, widgetId)];
  }
  if (kind === 'bool' && (a.action.behavior ?? DEFAULT_BUTTON_BEHAVIOR) === 'latch' && (a.trigger === 'hold' || a.trigger === 'toggle')) {
    return [actionFinding('warning', 'bool-latch-not-released',
      `${where}: bool param "${presentKey(a.action)}" with behavior "latch" flips on start and ignores the stop of a "${a.trigger}" action; use behavior "hold" (the param follows the action)`, widgetId)];
  }
  return [];
}

/** Bare param key of an effect-param mapping (for messages). */
function presentKey(m: LiveMapping): string {
  return String(fromLiveMapping(m).paramKey ?? '?');
}

/**
 * Postcondition findings for a button's script: every action's mapping is
 * valid for a button (`mappingFindings`), presets exist, the trigger delivers
 * the edges the target needs, and a duration is one the action honours.
 * Messages are prefixed with the action's position and trigger.
 */
export function buttonActionFindings(read: CoreReadApi, widgetId: string, actions: ButtonAction[] | undefined): Finding[] {
  const out: Finding[] = [];
  const presets = read.presets();
  (actions ?? []).forEach((a, i) => {
    const where = `action ${i + 1} (${a.trigger})`;
    for (const f of mappingFindings(read, 'button', a.action, widgetId)) out.push({ ...f, message: `${where}: ${f.message}` });
    if (a.action.type === 'preset' && !presets.some(p => p.id === a.action.presetId)) {
      out.push(actionFinding('error', 'preset-not-found', `${where}: preset "${a.action.presetId ?? ''}" not found`, widgetId));
    }
    out.push(...triggerFindings(read, a, where, widgetId));
    if (a.duration && a.duration.mode !== 'forever' && !durationModesFor(a).includes(a.duration.mode)) {
      out.push(actionFinding('warning', 'duration-ignored', `${where}: duration "${a.duration.mode}" is ignored for this trigger / action`, widgetId));
    }
  });
  return out;
}
