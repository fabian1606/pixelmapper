/**
 * Timed trigger actions inside a live capture (`observe.triggers`, WP-M
 * item 5).
 *
 * "Trigger, then observe" as two tool calls misses the first second of the
 * response (each call takes about a second). Instead the request lists
 * actions with an offset `at` inside the window; the capture's wait is
 * split at those offsets and each action fires through `fireTrigger` — the
 * same performer path as `modifiers.trigger` (no undo step, project
 * unchanged).
 */
import { errorFinding, infoFinding, warningFinding, type Finding, type ObserveTrigger } from '@pixelmapper/agent-kit';
import type { CoreReadApi } from '~/utils/operations/read-api';
import { checkTriggerAction, fireTrigger, type TriggerAction, type TriggerResult } from '~/utils/operations/core/modifier-trigger';
import { parseTimeRef } from './types';

// ── Plan ────────────────────────────────────────

/** A validated trigger action with its offset in seconds. */
export interface ScheduledTrigger {
  atS: number;
  action: TriggerAction;
}

/** Fires one action (default `fireTrigger`; injectable for tests). */
export type TriggerFirer = (read: CoreReadApi, action: TriggerAction) => TriggerResult;

/**
 * Validates the timed triggers of a request: live mode only, `at` inside
 * the window, the modifier / trigger param exist. Returns the schedule
 * (sorted by `at`) or error findings.
 */
export function planTriggers(
  triggers: readonly ObserveTrigger[] | undefined,
  opts: { mode: string; durationS: number; bpm: number; read: CoreReadApi; check?: (read: CoreReadApi, a: TriggerAction) => void },
): { schedule: ScheduledTrigger[]; errors: Finding[] } {
  if (!triggers || triggers.length === 0) return { schedule: [], errors: [] };
  if (opts.mode !== 'live') {
    return { schedule: [], errors: [errorFinding('invalid-input', '`triggers` need mode "live"; a preview freezes trigger states through `plugin.params` instead')] };
  }
  const check = opts.check ?? checkTriggerAction;
  const errors: Finding[] = [];
  const schedule: ScheduledTrigger[] = [];
  triggers.forEach((t, i) => {
    const atS = parseTimeRef(t.at, opts.bpm, Number.NaN);
    if (!Number.isFinite(atS) || atS >= opts.durationS) {
      errors.push(errorFinding('invalid-input', `triggers.${i}.at: "${t.at}" must be a time inside the window (0 ≤ at < ${opts.durationS}s)`));
      return;
    }
    const action: TriggerAction = { modifierId: t.modifierId, paramKey: t.paramKey, action: t.action, ...(t.clicks !== undefined ? { clicks: t.clicks } : {}) };
    try {
      check(opts.read, action);
      schedule.push({ atS, action });
    }
    catch (err) {
      errors.push(errorFinding('invalid-input', `triggers.${i}: ${(err as Error).message}`, [`modifier:${t.modifierId}`]));
    }
  });
  schedule.sort((a, b) => a.atS - b.atS);
  return { schedule, errors };
}

// ── Firing ──────────────────────────────────────

/**
 * Wraps the capture's `wait`: the window wait is split at the scheduled
 * offsets and each action fires at its offset. Results / failures are
 * pushed to `findings` as they happen.
 */
export function waitWithTriggers(
  wait: (ms: number) => Promise<void>,
  schedule: readonly ScheduledTrigger[],
  read: CoreReadApi,
  findings: Finding[],
  fire: TriggerFirer = fireTrigger,
): (ms: number) => Promise<void> {
  if (schedule.length === 0) return wait;
  return async (ms: number) => {
    let elapsed = 0;
    for (const s of schedule) {
      const atMs = s.atS * 1000;
      if (atMs > ms) break;
      if (atMs > elapsed) await wait(atMs - elapsed);
      elapsed = Math.max(elapsed, atMs);
      const what = `${s.action.action}${s.action.clicks ? ` ×${s.action.clicks}` : ''} ${s.action.modifierId}.${s.action.paramKey} at ${s.atS.toFixed(2)}s`;
      try {
        const r = fire(read, s.action);
        findings.push(infoFinding('observe-trigger', `${what} (engine ${Math.round(r.engineTimeMs)} ms)`, [`modifier:${s.action.modifierId}`]), ...r.findings);
      }
      catch (err) {
        findings.push(warningFinding('observe-trigger-failed', `${what} failed: ${(err as Error).message}`, [`modifier:${s.action.modifierId}`]));
      }
    }
    if (ms > elapsed) await wait(ms - elapsed);
  };
}

/** Warns about triggers whose last scheduled action holds them pressed. */
export function heldTriggerFindings(schedule: readonly ScheduledTrigger[]): Finding[] {
  const last = new Map<string, ScheduledTrigger>();
  for (const s of schedule) last.set(`${s.action.modifierId}.${s.action.paramKey}`, s);
  return [...last.entries()]
    .filter(([, s]) => s.action.action === 'press')
    .map(([key, s]) => warningFinding('observe-trigger-held', `${key} is still pressed after the window; release it (modifiers.trigger action "release") so the rig is not left held`, [`modifier:${s.action.modifierId}`]));
}
