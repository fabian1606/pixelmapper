import { deepEqual, isPlainObject } from '~/utils/sync/merge/values';
import { byId, diffMaps, type Entity, type EntitySpec, idKey } from './compare';
import type { KindDiff } from './types';

/**
 * Scene part of the version diff: the `sceneNodes` tree is flattened into
 * fixtures and groups (any depth), each annotated with its parent group, so
 * moving a fixture into another group shows up as a "group" change.
 */

/** Synthetic keys added while flattening. */
const PARENT = '__parent';
const MEMBERS = '__members';

/** Same rule as `snapshot_summary` (migration 010): `_type: 'group'` or a `children` array. */
function isGroup(node: Entity): boolean {
  return node._type === 'group' || Array.isArray(node.children);
}

/** Flattens the tree into fixtures and groups (children replaced by member ids). */
export function flattenScene(nodes: unknown): { fixtures: Entity[]; groups: Entity[] } {
  const fixtures: Entity[] = [];
  const groups: Entity[] = [];
  const walk = (list: unknown, parent: string | null) => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!isPlainObject(node)) continue;
      if (isGroup(node)) {
        const { children, ...rest } = node;
        const kids = Array.isArray(children) ? children : [];
        const members = kids.map(c => (isPlainObject(c) ? idKey(c.id) : null)).filter((k): k is string => k !== null);
        groups.push({ ...rest, [PARENT]: parent, [MEMBERS]: members });
        walk(kids, idKey(node.id));
      }
      else {
        fixtures.push({ ...node, [PARENT]: parent });
      }
    }
  };
  walk(nodes, null);
  return { fixtures, groups };
}

// ── Specs ────────────────────────────────────────────────────────────────────

/** Channel list without colors (to tell a color-only change apart). */
function withoutColors(channels: unknown): unknown {
  return Array.isArray(channels)
    ? channels.map(c => (isPlainObject(c) ? { ...c, colorValue: undefined } : c))
    : channels;
}

/** "color" when only channel colors changed, otherwise "channels" (+ "color"). */
function channelLabels(prev: Entity, next: Entity): string[] {
  if (deepEqual(prev.channels, next.channels)) return [];
  const colorsOnlyEqual = deepEqual(withoutColors(prev.channels), withoutColors(next.channels));
  if (colorsOnlyEqual) return ['color'];
  const sameShape = Array.isArray(prev.channels) && Array.isArray(next.channels) && prev.channels.length === next.channels.length;
  const colorChanged = sameShape && (prev.channels as unknown[]).some((c, i) =>
    isPlainObject(c) && isPlainObject((next.channels as unknown[])[i]) && c.colorValue !== ((next.channels as unknown[])[i] as Entity).colorValue);
  return colorChanged ? ['channels', 'color'] : ['channels'];
}

/** Name field as a string. */
const nameOf = (e: Entity) => (typeof e.name === 'string' ? e.name : undefined);

export const FIXTURE_SPEC: EntitySpec = {
  name: nameOf,
  fields: {
    name: 'name',
    fixturePosition: 'position',
    positionZ: 'position',
    rotation: 'rotation',
    tiltX: 'rotation',
    rollZ: 'rotation',
    fixtureSize: 'size',
    startAddress: 'address',
    manufacturer: 'fixture type',
    fixtureType: 'fixture type',
    oflKey: 'fixture type',
    beams: 'beams',
    lensDegreesMinMax: 'beam angle',
    motionRange: 'fixture type',
    dimensionsMm: 'fixture type',
    kind: 'kind settings',
    extensionData: 'extension data',
    [PARENT]: 'group',
  },
  ignore: ['_type', 'id'],
  customKeys: ['channels'],
  custom: channelLabels,
};

/** "members" when membership changed, "order" when only the order did. */
function memberLabels(prev: Entity, next: Entity): string[] {
  const a = (prev[MEMBERS] ?? []) as string[];
  const b = (next[MEMBERS] ?? []) as string[];
  if (deepEqual(a, b)) return [];
  const same = a.length === b.length && a.every(id => b.includes(id));
  return [same ? 'order' : 'members'];
}

export const GROUP_SPEC: EntitySpec = {
  name: nameOf,
  fields: { name: 'name', [PARENT]: 'parent group' },
  // `expanded` is tree UI state, not project content.
  ignore: ['_type', 'id', 'expanded'],
  customKeys: [MEMBERS],
  custom: memberLabels,
};

// ── Diff ─────────────────────────────────────────────────────────────────────

/** Fixture and group changes between two `sceneNodes` trees. */
export function diffScene(prev: unknown, next: unknown): { fixtures: KindDiff; groups: KindDiff } {
  const a = flattenScene(prev);
  const b = flattenScene(next);
  const fixtures = diffMaps(byId(a.fixtures), byId(b.fixtures), FIXTURE_SPEC);
  const groups = diffMaps(byId(a.groups), byId(b.groups), GROUP_SPEC);
  // Flattened order follows the tree; moves are reported per entity instead.
  return { fixtures: { ...fixtures, reordered: false }, groups: { ...groups, reordered: false } };
}
