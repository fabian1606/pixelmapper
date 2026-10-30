/**
 * Core read API (ADR 0002 §4.1 `ctx.read`; plan A1.3).
 *
 * Typed, readonly access to project state for operations, independent of
 * Vue component scopes. Every call returns fresh plain objects (never live
 * model instances), so callers cannot mutate state through it. It reads the
 * current store state, so inside a transaction it reflects earlier ops.
 *
 * Coordinates: normalized world space 0–1 (`x` left→right, `y` top→bottom
 * as seen on the 2D canvas, the same space as plugin `Sample.x/y`); `z` is
 * the height above the floor, normalized like x/y.
 */
import type { FixtureView, SelectionInfo } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveModeStore } from '~/stores/live-mode-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { cloneModifiers } from '~/utils/engine/modifiers';
import type { ChannelType, ModifierInstance, Signature } from '~/utils/engine/types';
import type { LivePage } from '~/utils/live/types';
import type { PresetType } from '~/utils/engine/preset-types';
import { fixtureView as projectFixture, selectionView } from '~/utils/extensions/scope-views';

// ── Views ───────────────────────────────────────

/** Compact fixture view (digest / find). */
export interface FixtureInfo {
  id: string | number;
  name: string;
  /** Fixture kind id (generated fixtures) or `undefined`. */
  kind?: string;
  /** OFL key (`generic/drgb-fader`) for library fixtures. */
  oflKey?: string;
  /** Normalized world position 0–1 (like `Sample.x/y`). */
  x: number;
  y: number;
  /** Height above the floor, normalized like x/y. */
  z: number;
  /** Yaw in degrees (0–360). */
  rotation: number;
  /** Number of heads / pixels (beams); 1 for single-head fixtures. */
  heads: number;
  /** Signatures modifiers can target on this fixture. */
  signatures: Signature[];
  /** Non-fine channel types (scalar targets), deduplicated. */
  channelTypes: ChannelType[];
  /** Ids of all groups containing the fixture (innermost first). */
  groupIds: Array<string | number>;
  universe: number;
  /** 1-based DMX start address within the universe. */
  address: number;
  channelCount: number;
}

/** Group view. */
export interface GroupInfo {
  id: string | number;
  name: string;
  parentId: string | number | null;
  /** All fixtures inside the group (deep). */
  fixtureIds: Array<string | number>;
}

/** Compact saved-preset view (live button actions pick their trigger from the type). */
export interface PresetInfo {
  id: string;
  name: string;
  /** Absent = normal (switches the base preset); flash / overwrite act while held. */
  type?: PresetType;
}

/** Readonly project access for operations. */
export interface CoreReadApi {
  /** Effective base BPM (what tap tempo / `project.setBpm` writes). */
  bpm(): number;
  fixtures(): FixtureInfo[];
  fixture(id: string | number): FixtureInfo | null;
  /** Full fixture projection (channels with values, kind config, extension data). */
  fixtureDetail(id: string | number): FixtureView | null;
  groups(): GroupInfo[];
  /** Modifier instances (deep copies) in stack order. */
  modifiers(): ModifierInstance[];
  modifier(id: string): ModifierInstance | null;
  /** Live pages (deep copies). */
  livePages(): LivePage[];
  /** Saved presets (id, name, type). */
  presets(): PresetInfo[];
  selection(): SelectionInfo;
  /** Project-level extension data (deep copy). */
  projectExtensionData(): Record<string, Record<string, unknown>> | undefined;
}

// ── Helpers ─────────────────────────────────────

/** JSON deep copy (works through Vue proxies). */
function jsonClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Signatures a fixture offers (any head). */
export function fixtureSignatures(fixture: Fixture): Signature[] {
  const out: Signature[] = [];
  const types = new Set(fixture.channels.filter(c => !c.isFine).map(c => c.type));
  if (types.has('RED') && types.has('GREEN') && types.has('BLUE')) out.push('rgb');
  if (types.has('PAN') && types.has('TILT')) out.push('panTilt');
  if (types.size > 0) out.push('scalar');
  return out;
}

/** Group ids containing a node, innermost first. */
function groupChain(node: SceneNode): Array<string | number> {
  const out: Array<string | number> = [];
  for (let p = node.parent; p; p = p.parent) out.push(p.id);
  return out;
}

/** Projects a fixture into its compact view. */
export function fixtureInfo(f: Fixture): FixtureInfo {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind?.id,
    oflKey: f.oflKey,
    x: f.fixturePosition.x,
    y: f.fixturePosition.y,
    z: f.positionZ ?? 0,
    rotation: f.rotation,
    heads: Math.max(1, f.beams?.length ?? 0),
    signatures: fixtureSignatures(f),
    channelTypes: [...new Set(f.channels.filter(c => !c.isFine).map(c => c.type))],
    groupIds: groupChain(f),
    universe: f.universe,
    address: f.localAddress,
    channelCount: f.channels.length,
  };
}

/** All groups (depth-first). */
function collectGroups(nodes: readonly SceneNode[], parentId: string | number | null, out: GroupInfo[]): void {
  for (const n of nodes) {
    if (!(n instanceof FixtureGroup)) continue;
    const fixtureIds: Array<string | number> = [];
    const walk = (children: readonly SceneNode[]) => {
      for (const c of children) {
        if (c instanceof FixtureGroup) walk(c.children);
        else fixtureIds.push(c.id);
      }
    };
    walk(n.children);
    out.push({ id: n.id, name: n.name, parentId, fixtureIds });
    collectGroups(n.children, n.id, out);
  }
}

// ── Implementation ──────────────────────────────

/** Creates the read API over the engine and live-mode stores. */
export function createCoreReadApi(): CoreReadApi {
  const engine = () => useEngineStore();
  const findFixture = (id: string | number) => (engine().flatFixtures as Fixture[]).find(f => f.id === id) ?? null;

  return {
    bpm: () => engine().baseBpm,
    fixtures: () => (engine().flatFixtures as Fixture[]).map(fixtureInfo),
    fixture: (id) => {
      const f = findFixture(id);
      return f ? fixtureInfo(f) : null;
    },
    fixtureDetail: (id) => {
      const f = findFixture(id);
      return f ? projectFixture(f) : null;
    },
    groups: () => {
      const out: GroupInfo[] = [];
      collectGroups(engine().sceneNodes as SceneNode[], null, out);
      return out;
    },
    modifiers: () => cloneModifiers(engine().modifiers),
    modifier: (id) => {
      const m = engine().modifiers.find(x => x.id === id);
      return m ? cloneModifiers([m])[0]! : null;
    },
    livePages: () => jsonClone(useLiveModeStore().pages) as LivePage[],
    presets: () => engine().savedPresets.map(p => ({ id: p.id, name: p.name, ...(p.type ? { type: p.type } : {}) })),
    selection: () => selectionView(engine().selectedIds, engine().sceneNodes as SceneNode[]),
    projectExtensionData: () => jsonClone(engine().projectExtension.extensionData) as Record<string, Record<string, unknown>> | undefined,
  };
}

/** The app-wide read API (stateless; reads the stores on every call). */
export const readApi: CoreReadApi = createCoreReadApi();
