import type { SerializedFixture } from '~/utils/engine/serialize';
import type { EntityId, MergeConflict } from '../types';
import { deepClone } from '../values';
import { registerRebaseAdapter, type RebaseAdapter, type RebaseState } from './registry';
import { findFixture, findWidgetAnywhere, mergeField, ok, skip } from './helpers';

/**
 * Rebase adapters for per-fixture property commands (channel-level ones
 * live in `channels.ts`). Most payloads carry
 * `before`/`after` per fixture, so they get a real field-level 3-way merge:
 * base = before, local = after, remote = current fixture state. Entries whose
 * fixture (or channel) no longer exists are dropped; a change with no entry
 * left is skipped.
 */

// ── Payloads ─────────────────────────────────────────────────────────────────

interface PositionEntry { id: EntityId; x: number; y: number; z?: number }
interface RotationEntry { id: EntityId; rotation: number; tiltX?: number; rollZ?: number; x?: number; y?: number }
interface BeforeAfter<T> { before: T[]; after: T[] }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Current position in the `MoveFixture` entry shape. */
function positionOf(f: SerializedFixture, withZ: boolean): PositionEntry {
  const out: PositionEntry = { id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y };
  if (withZ) out.z = f.positionZ ?? 0;
  return out;
}

/** Current rotation in the `RotateFixture` entry shape (only the fields the entry uses). */
function rotationOf(f: SerializedFixture, like: RotationEntry): RotationEntry {
  const out: RotationEntry = { id: f.id, rotation: f.rotation };
  if (like.tiltX !== undefined) out.tiltX = f.tiltX ?? 0;
  if (like.rollZ !== undefined) out.rollZ = f.rollZ ?? 0;
  // Group rotations also orbit member positions.
  if (like.x !== undefined) out.x = f.fixturePosition.x;
  if (like.y !== undefined) out.y = f.fixturePosition.y;
  return out;
}

/**
 * Generic before/after-per-fixture rebase: for each `after` entry whose
 * fixture exists, merge base (`before` entry) / local / remote (`read`).
 */
function rebasePerFixture<T extends { id: EntityId }>(
  payload: BeforeAfter<T>,
  state: RebaseState,
  read: (f: SerializedFixture, like: T) => T,
  label: string,
): ReturnType<RebaseAdapter> {
  const conflicts: MergeConflict[] = [];
  const before: T[] = [];
  const after: T[] = [];
  for (const entry of payload.after ?? []) {
    const fixture = findFixture(state, entry.id);
    if (!fixture) continue;
    // No recorded base → treat as added on both sides (local wins field-wise).
    const base = payload.before?.find(b => b.id === entry.id);
    const remote = read(fixture, entry);
    before.push(remote);
    after.push(mergeField(base, entry, remote, entry.id, [entry.id], conflicts) as T);
  }
  if (after.length === 0) return skip(payload, `fixtures to ${label} no longer exist`);
  return ok({ ...payload, before, after }, conflicts);
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/** `MoveFixture`: per fixture x/y(/z) 3-way merge. */
export const moveFixtureAdapter: RebaseAdapter = (payload: BeforeAfter<PositionEntry>, { current }) =>
  rebasePerFixture(payload, current, (f, like) => positionOf(f, like.z !== undefined), 'move');

/** `RotateFixture`: per fixture rotation/tilt/roll(/x/y) 3-way merge. */
export const rotateFixtureAdapter: RebaseAdapter = (payload: BeforeAfter<RotationEntry>, { current }) =>
  rebasePerFixture(payload, current, rotationOf, 'rotate');

/** `UpdateDmx`: 3-way merge of the start address. */
export const updateDmxAdapter: RebaseAdapter = (payload, { current }) => {
  const f = findFixture(current, payload.fixtureId);
  if (!f) return skip(payload, `fixture ${payload.fixtureId} no longer exists`);
  const conflicts: MergeConflict[] = [];
  const afterAddress = mergeField(payload.beforeAddress, payload.afterAddress, f.startAddress, f.id, [f.id, 'startAddress'], conflicts);
  return ok({ ...payload, beforeAddress: f.startAddress, afterAddress }, conflicts);
};

/** `SetFixtureKindConfig`: field-level merge of the kind config object. */
export const setFixtureKindConfigAdapter: RebaseAdapter = (payload, { current }) => {
  const f = findFixture(current, payload.fixtureId);
  if (!f?.kind) return skip(payload, `kind fixture ${payload.fixtureId} no longer exists`);
  const conflicts: MergeConflict[] = [];
  const after = mergeField(payload.before, payload.after, f.kind.config, f.id, [f.id, 'kind', 'config'], conflicts);
  return ok({ ...payload, before: deepClone(f.kind.config), after }, conflicts);
};

/** `SetExtensionData`: 3-way merge of one `extensionData[extensionId][key]` value. */
export const setExtensionDataAdapter: RebaseAdapter = (payload, { current }) => {
  type Holder = { extensionData?: Record<string, Record<string, unknown>> };
  let holder: Holder | undefined;
  if (payload.owner === 'project') holder = { extensionData: current.extensionData };
  else if (payload.owner === 'fixture') holder = findFixture(current, payload.ownerId);
  else holder = findWidgetAnywhere(current, payload.ownerId);
  if (!holder) return skip(payload, `${payload.owner} ${payload.ownerId} no longer exists`);
  const remote = holder.extensionData?.[payload.extensionId]?.[payload.key];
  const conflicts: MergeConflict[] = [];
  const path = [payload.owner, payload.ownerId ?? '', payload.extensionId, payload.key];
  const after = mergeField(payload.before, payload.after, remote, payload.ownerId ?? null, path, conflicts);
  const out = { ...payload, before: deepClone(remote), after };
  // `undefined` means "absent / delete" → keep the key out of the JSON payload.
  if (out.before === undefined) delete out.before;
  if (out.after === undefined) delete out.after;
  return ok(out, conflicts);
};

/** `fixture.drag` live-op: drop entries whose fixture is gone. */
export const fixtureDragAdapter: RebaseAdapter = (payload: { fixtures: PositionEntry[] }, { current }) => {
  const fixtures = (payload.fixtures ?? []).filter(e => findFixture(current, e.id));
  return fixtures.length ? ok({ ...payload, fixtures }) : skip(payload, 'dragged fixtures no longer exist');
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all fixture property adapters. */
export function registerFixtureAdapters(): void {
  registerRebaseAdapter('MoveFixture', moveFixtureAdapter);
  registerRebaseAdapter('RotateFixture', rotateFixtureAdapter);
  registerRebaseAdapter('UpdateDmx', updateDmxAdapter);
  registerRebaseAdapter('SetFixtureKindConfig', setFixtureKindConfigAdapter);
  registerRebaseAdapter('SetExtensionData', setExtensionDataAdapter);
  registerRebaseAdapter('fixture.drag', fixtureDragAdapter);
}
