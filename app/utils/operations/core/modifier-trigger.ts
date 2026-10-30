/**
 * `modifiers.trigger` (action): presses / releases / clicks a `trigger`
 * param (ABI 1.3) of a modifier the way a performer does — through the same
 * path as the card's press-and-hold button and live `button` widgets
 * (`setEffectTrigger`). Momentary input: NO undo step, never rolled back,
 * skipped on dry runs.
 *
 * Returns the engine-clock time of the edge(s) (`Frame.timeMs` the plugin
 * sees), so a following live `observe` can check hold, release and
 * multi-click envelopes against it.
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import type { TriggerValue } from '@pixelmapper/extension-api';
import { currentEngineClockMs, setEffectTrigger } from '~/composables/live-ops/effect-trigger';
import { getManifest } from '~/utils/plugins/plugin-store';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import { ModifierIdSchema, requireModifier } from './shared';

// ── Helpers ─────────────────────────────────────

/** Most clicks one `click` action may send (a burst, not a stress test). */
const MAX_CLICKS = 8;

/** Plugin param key without the stored `params.` prefix. */
function bareParamKey(key: string): string {
  return key.startsWith('params.') ? key.slice('params.'.length) : key;
}

/**
 * Checks that `modifierId` names exactly one instance (see `requireModifier`) and `key` is one of its plugin's trigger
 * params; throws a readable error (naming the trigger keys) otherwise.
 */
function requireTriggerParam(read: CoreReadApi, modifierId: string, key: string): void {
  const modifier = requireModifier(read, modifierId);
  const manifest = getManifest(modifier.plugin);
  if (!manifest) throw new Error(`the plugin of modifier "${modifierId}" is not loaded; its param types are unknown`);
  const triggers = manifest.params.filter(p => p.type === 'trigger').map(p => p.key);
  const hint = triggers.length ? `trigger params: ${triggers.join(', ')}` : 'it has no trigger params';
  const param = manifest.params.find(p => p.key === key);
  if (!param) throw new Error(`modifier "${modifierId}" has no param "${key}" (${hint})`);
  if (param.type !== 'trigger') throw new Error(`param "${key}" of modifier "${modifierId}" is a ${param.type} param, not a trigger (${hint}); set other params with modifiers.update`);
}

// ── Operation ───────────────────────────────────

/** `modifiers.trigger`. */
export const modifiersTrigger = defineCoreOperation({
  id: 'modifiers.trigger',
  kind: 'action',
  description: [
    'Press, release or click a trigger param of a modifier like a performer on the card button / a live button: momentary input, NO undo step, not rolled back, skipped on dryRun.',
    'action: "press" (held until "release"), "release", or "click" (press + release; `clicks` > 1 sends a multi-click burst within the plugin\'s multi-click window, so the plugin sees clicks = n). On a held trigger the first click\'s press is a no-op, so the hold counts as the first click.',
    'Returns engineTimeMs: the engine-clock time of the edge(s), the same clock as the plugin\'s ctx.timeMs / pressedAt / releasedAt. Follow with a live observe to verify hold, release or double-click behavior.',
    'Never write trigger timestamps with modifiers.update; use this op. Errors when the modifier is unknown or paramKey is not a trigger param.',
  ].join('\n'),
  input: z.object({
    modifierId: ModifierIdSchema,
    paramKey: z.string().min(1).describe('Trigger param key of the plugin (e.g. "hit"; "params.hit" works too).'),
    action: z.enum(['press', 'release', 'click']).describe('"press" holds, "release" lets go, "click" = press + release.'),
    clicks: z.number().int().min(1).max(MAX_CLICKS).optional().describe(`Only for action "click": number of clicks in the burst (default 1, max ${MAX_CLICKS}).`),
  }),
  output: z.object({
    modifierId: z.string(),
    paramKey: z.string(),
    action: z.string(),
    engineTimeMs: z.number().describe('Engine-clock ms of the edge(s) (plugin ctx.timeMs clock).'),
    wallTimeMs: z.number().describe('Wall clock (Date.now()) at the edge, for correlating with observe captures.'),
    changed: z.boolean().describe('False when the edge changed nothing (e.g. press on a held trigger).'),
    value: z.object({
      pressed: z.boolean(),
      pressedAt: z.number().optional(),
      releasedAt: z.number().optional(),
      clicks: z.number().optional(),
    }).describe('Trigger state after the action.'),
  }),
  examples: [
    { input: { modifierId: 'ai-flash', paramKey: 'hit', action: 'click' }, note: 'One tap.' },
    { input: { modifierId: 'ai-flash', paramKey: 'hit', action: 'click', clicks: 2 }, note: 'Double click.' },
    { input: { modifierId: 'ai-flash', paramKey: 'hit', action: 'press' }, note: 'Hold; observe, then send "release".' },
  ],
  run(ctx, input) {
    const key = bareParamKey(input.paramKey);
    requireTriggerParam(ctx.read, input.modifierId, key);
    if (input.clicks !== undefined && input.action !== 'click') throw new Error('clicks is only valid with action "click"');

    // One timestamp for every edge of the action, so the burst is one instant.
    const engineTimeMs = currentEngineClockMs();
    const wallTimeMs = Date.now();
    const edges: boolean[] = input.action === 'press' ? [true]
      : input.action === 'release' ? [false]
        : Array.from({ length: input.clicks ?? 1 }, () => [true, false]).flat();
    let changed = false;
    for (const pressed of edges) changed = setEffectTrigger(input.modifierId, key, pressed, engineTimeMs) || changed;

    const value = (ctx.read.modifier(input.modifierId)?.params[key] ?? { pressed: false }) as TriggerValue;
    const findings: Finding[] = changed ? [] : [{
      level: 'info',
      code: 'trigger-unchanged',
      message: `trigger "${key}" was already ${value.pressed ? 'pressed' : 'released'}; nothing changed`,
      entityIds: [`modifier:${input.modifierId}`],
    }];
    return {
      kind: 'action',
      value: { modifierId: input.modifierId, paramKey: key, action: input.action, engineTimeMs, wallTimeMs, changed, value: { ...value } },
      findings,
    };
  },
});
