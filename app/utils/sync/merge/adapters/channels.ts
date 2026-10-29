import type { SerializedChannel } from '~/utils/engine/serialize';
import type { EntityId, MergeConflict } from '../types';
import { deepClone } from '../values';
import { registerRebaseAdapter, type RebaseAdapter, type RebaseState } from './registry';
import { findFixture, mergeField, ok, skip } from './helpers';

/**
 * Rebase adapters for per-channel commands and live-ops. Each change carries
 * `before`/`after` per (fixtureId, channelIndex), so it gets a field-level
 * 3-way merge: base = before, local = after, remote = current channel state.
 * Changes whose channel no longer exists are dropped; nothing left → skipped.
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

interface ChannelChange<T> { fixtureId: EntityId; channelIndex: number; before: T; after: T }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Channel of a fixture, if both exist. */
function findChannel(state: RebaseState, fixtureId: EntityId, index: number): SerializedChannel | undefined {
  return findFixture(state, fixtureId)?.channels?.[index];
}

/**
 * Generic per-channel rebase (`SetChannelValues`, `SetChannelRange`):
 * merge each change against `read(channel, change)`; drop missing channels.
 */
function rebasePerChannel<T>(
  payload: { changes: ChannelChange<T>[] },
  state: RebaseState,
  read: (ch: SerializedChannel, change: ChannelChange<T>) => T,
): ReturnType<RebaseAdapter> {
  const conflicts: MergeConflict[] = [];
  const changes: ChannelChange<T>[] = [];
  for (const change of payload.changes ?? []) {
    const ch = findChannel(state, change.fixtureId, change.channelIndex);
    if (!ch) continue;
    const remote = read(ch, change);
    const path = [change.fixtureId, 'channels', change.channelIndex];
    const after = mergeField(change.before, change.after, remote, change.fixtureId, path, conflicts) as T;
    changes.push({ ...change, before: remote, after });
  }
  if (changes.length === 0) return skip(payload, 'target channels no longer exist');
  return ok({ ...payload, changes }, conflicts);
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/**
 * `SetChannelValues`: merge `{ colorValue, chaserConfig }` (the fields execute
 * applies); `stepValues` mirrors the merged `chaserConfig.stepValues`.
 */
export const setChannelValuesAdapter: RebaseAdapter = (payload, { current }) => {
  type Snap = { stepValues?: number[]; colorValue: string; chaserConfig?: Record<string, unknown> };
  const strip = (s: Snap) => ({ colorValue: s?.colorValue, chaserConfig: s?.chaserConfig });
  const withSteps = (s: { colorValue: string; chaserConfig?: Record<string, unknown> }, fallback?: number[]) => ({
    stepValues: deepClone((s.chaserConfig?.stepValues as number[] | undefined) ?? fallback ?? []),
    ...s,
  });
  const stripped = {
    changes: ((payload as { changes: ChannelChange<Snap>[] }).changes ?? []).map(c => ({ ...c, before: strip(c.before), after: strip(c.after) })),
  };
  const res = rebasePerChannel(stripped, current, ch => ({ colorValue: ch.colorValue, chaserConfig: deepClone(ch.chaserConfig) }));
  if (res.skipped) return { ...res, payload };
  const rebased = res.payload as { changes: ChannelChange<{ colorValue: string; chaserConfig?: Record<string, unknown> }>[] };
  return ok({
    ...(payload as object),
    changes: rebased.changes.map(c => ({ ...c, before: withSteps(c.before), after: withSteps(c.after) })),
  }, res.conflicts);
};

/** `SetChannelRange`: merge `{ rangeMin, rangeMax, defaultValue }` per channel. */
export const setChannelRangeAdapter: RebaseAdapter = (payload, { current }) =>
  rebasePerChannel<Record<string, number>>(payload, current, (ch, change) => {
    const out: Record<string, number> = { rangeMin: ch.rangeMin ?? 0, rangeMax: ch.rangeMax ?? 255 };
    // `defaultValue` is optional in the payload; only compare it when recorded.
    if (change.after?.defaultValue !== undefined || change.before?.defaultValue !== undefined) out.defaultValue = ch.defaultValue;
    return out;
  });

/** `channel.update` live-op (absolute values per channel). */
export const channelUpdateAdapter: RebaseAdapter = (payload: { channels: Array<{ fixtureId: EntityId; channelIndex: number }> }, { current }) => {
  const channels = (payload.channels ?? []).filter(c => findChannel(current, c.fixtureId, c.channelIndex));
  return channels.length ? ok({ ...payload, channels }) : skip(payload, 'target channels no longer exist');
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all channel adapters. */
export function registerChannelAdapters(): void {
  registerRebaseAdapter('SetChannelValues', setChannelValuesAdapter);
  registerRebaseAdapter('SetChannelRange', setChannelRangeAdapter);
  registerRebaseAdapter('channel.update', channelUpdateAdapter);
}
