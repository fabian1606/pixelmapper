import { reactive } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { setActivePreset, pressFlashPreset, releaseFlashPreset, stopEverything } from '~/components/engine/composables/preset-activation';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import { applyMapping, type DimmerState } from './apply-mapping';
import type { ButtonAction } from '~/utils/live/types';
import {
  DOUBLE_PRESS_MS,
  beatMs,
  cycleMs,
  durationMs,
  effectiveDuration,
  holdMs,
  isInstantAction,
  isNormalPreset,
} from '~/utils/live/button-actions';

/**
 * Runtime for scripted buttons (canvas buttons and controller pads). Turns
 * press / release of a button into its actions' triggers and durations, and
 * maps each action onto the existing primitives — flash stack, overwrite
 * stack and {@link applyMapping} — so nothing is re-implemented.
 *
 * Every action runs under its own sub-key `${buttonKey}#${action.id}`, which
 * keeps flash / overwrite entries of different actions apart.
 *
 * Module singleton (like use-history): one runtime per tab. Flash, overwrite,
 * preset and speed changes broadcast through the LiveBus as before; toggle and
 * long-press progress are local to the tab that was pressed.
 */

export interface ButtonContext {
  /** Button key: widget.id, or `${twinId}::${controlId}` for pads. */
  key: string;
  dimmerState?: DimmerState;
}

/** Reactive state the views read (lit state, long-press bar). */
const state = reactive({
  /** Sub-keys of actions that are currently running. */
  running: new Set<string>(),
  /** Long-press progress per button key: started at / fires at (performance.now ms). */
  longPress: new Map<string, { startedAt: number; at: number }>(),
});

const stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
const longTimers = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }[]>();
const lastPressAt = new Map<string, number>();

function subKey(key: string, a: ButtonAction): string {
  return `${key}#${a.id}`;
}

function currentBpm(): number {
  return useEngineStore().engine?.globalBpm?.value ?? 120;
}

/** One pass of a preset: the slowest cycle among its modifiers (1 beat if none animate). */
function presetPassMs(presetId: string | undefined): number {
  const engineStore = useEngineStore();
  const bpm = currentBpm();
  const preset = engineStore.savedPresets.find(p => p.id === presetId);
  if (!preset) return beatMs(bpm);
  const resolved = resolvePreset(preset, engineStore.savedPresets);
  const cycles = resolved.categories.flatMap(c => c.modifiers ?? []).map(m => cycleMs(m.speed, bpm));
  const longest = Math.max(0, ...cycles);
  return longest > 0 ? longest : beatMs(bpm);
}

// ── Starting / stopping one action ──────────────────────────────────────────

/**
 * Starts an action. `momentary` = it will be stopped again (held, toggled or
 * timed); otherwise it stays (forever). A forever normal preset becomes the
 * active preset; a momentary one is pushed onto the flash stack.
 */
function startAction(a: ButtonAction, ctx: ButtonContext, momentary: boolean): void {
  const m = a.action;
  if (m.type === 'none') return;
  const sk = subKey(ctx.key, a);

  if (m.type === 'global-function' && m.globalFunction === 'stop-all') {
    stopAll();
    return;
  }
  if (isInstantAction(m)) {
    applyMapping(m, true, { key: sk, dimmerState: ctx.dimmerState });
    return;
  }
  if (isNormalPreset(m, useEngineStore().savedPresets)) {
    if (momentary) pressFlashPreset(sk, m.presetId!);
    else setActivePreset(m.presetId!);
  } else {
    applyMapping(m, true, { key: sk, dimmerState: ctx.dimmerState });
  }
  // A forever normal preset is reflected by the active preset, not by `running`.
  if (momentary || !isNormalPreset(m, useEngineStore().savedPresets)) state.running.add(sk);
}

/** Stops a running action (no-op when it is not running). */
function stopAction(a: ButtonAction, ctx: ButtonContext): void {
  const sk = subKey(ctx.key, a);
  const timer = stopTimers.get(sk);
  if (timer) { clearTimeout(timer); stopTimers.delete(sk); }
  if (!state.running.has(sk)) return;
  state.running.delete(sk);

  const m = a.action;
  if (isNormalPreset(m, useEngineStore().savedPresets)) {
    releaseFlashPreset(sk);
  } else if (m.type === 'global-function' && m.globalFunction === 'speed') {
    // Speed has no stack: ending it means back to normal speed.
    useEngineStore().setSpeedMultiplier(1);
    queueMicrotask(() => useLiveBusStore().dispatch('engine.speed', { multiplier: 1 }));
  } else {
    applyMapping(m, false, { key: sk, dimmerState: ctx.dimmerState });
  }
}

/**
 * Fires a press / double / long / release action with its duration: forever
 * stays, timed ones stop after their time. Re-firing a timed action that is
 * still running only restarts its timer.
 */
function fireAction(a: ButtonAction, ctx: ButtonContext): void {
  const d = effectiveDuration(a);
  const ms = durationMs(d, currentBpm(), d.mode === 'once' ? presetPassMs(a.action.presetId) : 0);
  if (ms === null || isInstantAction(a.action)) {
    startAction(a, ctx, false);
    return;
  }
  const sk = subKey(ctx.key, a);
  if (!state.running.has(sk)) startAction(a, ctx, true);
  const prev = stopTimers.get(sk);
  if (prev) clearTimeout(prev);
  stopTimers.set(sk, setTimeout(() => stopAction(a, ctx), ms));
}

// ── Long press ──────────────────────────────────────────────────────────────

function cancelLongPress(key: string): void {
  for (const t of longTimers.get(key) ?? []) clearTimeout(t.timer);
  longTimers.delete(key);
  state.longPress.delete(key);
}

/** Points the progress bar at the next pending long-press threshold. */
function updateLongProgress(key: string, startedAt: number): void {
  const pending = longTimers.get(key) ?? [];
  if (pending.length === 0) { state.longPress.delete(key); return; }
  state.longPress.set(key, { startedAt, at: Math.min(...pending.map(p => p.at)) });
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Button went down. */
export function pressButton(actions: ButtonAction[] | undefined, ctx: ButtonContext): void {
  if (!actions?.length) return;
  const now = performance.now();
  const isDouble = now - (lastPressAt.get(ctx.key) ?? -Infinity) < DOUBLE_PRESS_MS;
  // A double press consumes the first press, so a third press starts a new pair.
  lastPressAt.set(ctx.key, isDouble ? -Infinity : now);
  cancelLongPress(ctx.key);

  for (const a of actions) {
    switch (a.trigger) {
      case 'press': fireAction(a, ctx); break;
      case 'double': if (isDouble) fireAction(a, ctx); break;
      case 'hold': startAction(a, ctx, true); break;
      case 'toggle':
        if (state.running.has(subKey(ctx.key, a))) stopAction(a, ctx);
        else startAction(a, ctx, true);
        break;
      case 'long': {
        const at = now + holdMs(a, currentBpm());
        const entry = {
          at,
          timer: setTimeout(() => {
            longTimers.set(ctx.key, (longTimers.get(ctx.key) ?? []).filter(e => e !== entry));
            updateLongProgress(ctx.key, now);
            fireAction(a, ctx);
          }, at - now),
        };
        longTimers.set(ctx.key, [...(longTimers.get(ctx.key) ?? []), entry]);
        break;
      }
      case 'release': break;
    }
  }
  updateLongProgress(ctx.key, now);
}

/** Button came back up. */
export function releaseButton(actions: ButtonAction[] | undefined, ctx: ButtonContext): void {
  cancelLongPress(ctx.key);
  if (!actions?.length) return;
  for (const a of actions) {
    if (a.trigger === 'hold') stopAction(a, ctx);
    if (a.trigger === 'release') fireAction(a, ctx);
  }
}

/**
 * Whether a button should look active: one of its actions is running, or one
 * of its normal presets is the active preset. Reactive (reads runtime state).
 */
export function isButtonActive(key: string, actions: ButtonAction[] | undefined): boolean {
  if (!actions?.length) return false;
  const engineStore = useEngineStore();
  for (const a of actions) {
    if (state.running.has(subKey(key, a))) return true;
    if (a.action.type === 'preset' && a.action.presetId && isNormalPreset(a.action, engineStore.savedPresets)
      && engineStore.selectedPresetId === a.action.presetId) return true;
  }
  return false;
}

/** Long-press progress 0–1 for a button, or null when no long press is pending. Reactive. */
export function longPressProgress(key: string, nowMs: number): number | null {
  const lp = state.longPress.get(key);
  if (!lp) return null;
  const total = lp.at - lp.startedAt;
  return total > 0 ? Math.min(1, Math.max(0, (nowMs - lp.startedAt) / total)) : 1;
}

/** Whether any long press is pending (views animate their bar only then). */
export function hasPendingLongPress(key: string): boolean {
  return state.longPress.has(key);
}

/**
 * "Stop all": active preset, flashes, overwrites (blackout / strobe / blind),
 * speed and every running button action off. Broadcast to other tabs.
 */
export function stopAll(opts: { fromRemote?: boolean } = {}): void {
  for (const t of stopTimers.values()) clearTimeout(t);
  stopTimers.clear();
  for (const key of [...longTimers.keys()]) cancelLongPress(key);
  state.running.clear();

  // Everything ends in one step with a single output frame (no flash in between).
  stopEverything({ fromRemote: opts.fromRemote });
  useEngineStore().setSpeedMultiplier(1);
  // Lit section slots go dark too.
  useLiveModeStore().activeSectionMembers = new Map();
  if (!opts.fromRemote) queueMicrotask(() => useLiveBusStore().dispatch('engine.stopAll', {}));
}
