import type { ProjectSnapshot, SerializedFixture, SerializedGroup, SerializedNode } from '~/utils/engine/serialize';
import type { ModifierInstance } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';

/**
 * Builders of minimal plain project state for the adapter tests. Only the
 * fields the adapters read are filled; casts keep the fixtures short.
 */

// ── Builders ─────────────────────────────────────────────────────────────────

/** Minimal project snapshot with overrides. */
export function makeState(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    schemaVersion: 3,
    sceneNodes: [],
    savedPresets: [],
    pinnedModifiers: [],
    globalBases: {},
    modifiers: [],
    livePages: [],
    liveControllers: [],
    ...over,
  };
}

/** Modifier with an id and params. */
export function mod(id: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ModifierInstance {
  return { id, plugin: 'p', strength: 1, params, ...extra } as unknown as ModifierInstance;
}

/** Fixture with position, rotation and channels. */
export function fixture(id: string | number, over: Partial<SerializedFixture> = {}): SerializedFixture {
  return {
    _type: 'fixture',
    id,
    name: `F${id}`,
    startAddress: 1,
    fixturePosition: { x: 0, y: 0 },
    fixtureSize: { x: 1, y: 1 },
    rotation: 0,
    manufacturer: 'm',
    fixtureType: 't',
    channels: [],
    beams: [],
    ...over,
  };
}

/** Group node. */
export function group(id: string | number, children: SerializedNode[], name = `G${id}`): SerializedGroup {
  return { _type: 'group', id, name, expanded: true, children };
}

/** Preset with categories. */
export function preset(id: string, over: Partial<Preset> = {}): Preset {
  return { id, name: id, createdAt: '2026-01-01', categories: [], ...over };
}
