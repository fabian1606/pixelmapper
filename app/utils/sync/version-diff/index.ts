import { isPlainObject } from '~/utils/sync/merge/values';
import { diffLists, isEmptyKind } from './compare';
import { LIVE_PAGE_SPEC, modifierSpec, PRESET_SPEC } from './entities';
import { diffScene } from './scene';
import { diffSettings } from './settings';
import type { DiffOptions, SnapshotDiff } from './types';

/**
 * Version-history diff (WP-SYNC "Version history"): what changed from an
 * older to a newer serialized project (`ProjectSnapshot` JSON as stored on
 * the server). Pure and defensive — malformed parts count as empty, so a
 * snapshot of an older schema still yields a best-effort diff.
 */

export type { DiffOptions, EntityChange, EntityRef, KindDiff, SettingChange, SnapshotDiff } from './types';

/** Compares `prev` (older) with `next` (newer). */
export function diffSnapshots(prev: unknown, next: unknown, options: DiffOptions = {}): SnapshotDiff {
  const a = isPlainObject(prev) ? prev : {};
  const b = isPlainObject(next) ? next : {};
  const { fixtures, groups } = diffScene(a.sceneNodes, b.sceneNodes);
  const modifiers = diffLists(a.modifiers, b.modifiers, modifierSpec(options));
  const presets = diffLists(a.savedPresets, b.savedPresets, PRESET_SPEC);
  const livePages = diffLists(a.livePages, b.livePages, LIVE_PAGE_SPEC);
  const settings = diffSettings(a, b);
  const empty = [fixtures, groups, modifiers, presets, livePages].every(isEmptyKind) && settings.length === 0;
  return { fixtures, groups, modifiers, presets, livePages, settings, empty };
}
