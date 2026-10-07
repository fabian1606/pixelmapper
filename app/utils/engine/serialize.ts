import { Fixture, type FixtureKindInstance } from './core/fixture'
import { FixtureGroup, type SceneNode } from './core/group'
import type { Channel, ChannelRenderInfo } from './core/channel'
import { Beam } from './core/beam'
import type { Preset } from './preset-types'
import type { ModifierInstance } from './types'
import type { PinnedModifier } from '~/stores/pinned-modifiers-store'
import type { LivePage, MovingHeadPosition } from '~/utils/live/types'
import { reactive } from 'vue'
import { cloneModifiers } from './modifiers'
import { cloneJson, rebuildKindFixture } from '~/utils/kinds/kind-host'
import type { ProjectRequirement } from '~/utils/extensions/requires'

// ─── Schema version ───────────────────────────────────────────────────────────

/**
 * Persisted format version (ADR D24). Version 2 introduced modifier
 * instances backed by content plugins; version-1 projects and presets are
 * not migrated.
 */
export const SCHEMA_VERSION = 2

/** Thrown when a snapshot has an incompatible schema version. */
export class IncompatibleProjectError extends Error {
  constructor(readonly found: unknown) {
    super('This project was created with an incompatible version of Pixelmapper and cannot be opened.')
    this.name = 'IncompatibleProjectError'
  }
}

// ─── Serialized types (plain JSON-safe objects) ───────────────────────────────

export interface SerializedChannel {
  type: Channel['type']
  addressOffset: number
  resolution?: 1 | 2 | 3
  fineAddressOffsets?: number[]
  isFine?: boolean
  role: Channel['role']
  colorValue: string
  oflChannelName?: string
  defaultValue: number
  rangeMin?: number
  rangeMax?: number
  beamId?: string
  renderInfo?: ChannelRenderInfo
  chaserConfig: any
}

export interface SerializedBeam {
  id: string
  localX: number
  localY: number
  localZ?: number
}

export interface SerializedFixture {
  _type: 'fixture'
  id: string | number
  name: string
  startAddress: number
  fixturePosition: { x: number; y: number }
  fixtureSize: { x: number; y: number }
  rotation: number
  /** Height above the floor, normalized like fixturePosition (3D viewport). */
  positionZ?: number
  /** Pitch/roll in degrees (Euler YXZ with `rotation` as yaw). */
  tiltX?: number
  rollZ?: number
  /** OFL lens beam angle range in degrees — drives 3D beam cones. */
  lensDegreesMinMax?: [number, number]
  manufacturer: string
  fixtureType: string
  oflKey?: string
  channels: SerializedChannel[]
  beams: SerializedBeam[]
  /** Fixture-kind state (config + compiled cache), ADR §5.6. */
  kind?: FixtureKindInstance
  /** Namespaced extension data, ADR §5.8. */
  extensionData?: Fixture['extensionData']
}

export interface SerializedGroup {
  _type: 'group'
  id: string | number
  name: string
  expanded: boolean
  children: SerializedNode[]
}

export type SerializedNode = SerializedFixture | SerializedGroup

export interface ProjectSnapshot {
  /** Persisted format version; must equal `SCHEMA_VERSION`. */
  schemaVersion: number
  sceneNodes: SerializedNode[]
  savedPresets: Preset[]
  pinnedModifiers: PinnedModifier[]
  globalBases: Record<string, number>
  modifiers: ModifierInstance[]
  livePages?: LivePage[]
  /** Controller instances persisted with the project. Auto-connect on load. */
  liveControllers?: import('~/utils/live/types').LiveControllerInstance[]
  /** Which preset is active at snapshot time — restored so reload keeps it. */
  selectedPresetId?: string | null
  /** Global BPM at snapshot time — restored on reload. */
  globalBpm?: number
  /** Shared clock epoch — restored so effects render deterministically. */
  clockEpoch?: number
  /**
   * Latched active-member sets for single/multi-select sections (sectionId →
   * memberKey[]). Restored on reload so lit-up buttons survive a page refresh.
   */
  activeSectionMembers?: Record<string, string[]>
  /** Saved moving head positions for live performance recall. */
  savedPositions?: MovingHeadPosition[]
  /** Extensions the project cannot be opened without (ADR D20). */
  requires?: ProjectRequirement[]
  /** Project-level namespaced extension data (ADR §5.8). */
  extensionData?: Record<string, Record<string, unknown>>
}

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeChannel(ch: Channel): SerializedChannel {
  return {
    type: ch.type,
    addressOffset: ch.addressOffset,
    resolution: ch.resolution,
    fineAddressOffsets: ch.fineAddressOffsets,
    isFine: ch.isFine,
    role: ch.role,
    colorValue: ch.colorValue,
    oflChannelName: ch.oflChannelName,
    defaultValue: ch.defaultValue,
    rangeMin: ch.rangeMin,
    rangeMax: ch.rangeMax,
    beamId: ch.beamId,
    renderInfo: ch.renderInfo ? JSON.parse(JSON.stringify(ch.renderInfo)) : undefined,
    chaserConfig: JSON.parse(JSON.stringify(ch.chaserConfig)),
  }
}

function serializeBeam(b: Beam): SerializedBeam {
  return { id: b.id, localX: b.localX, localY: b.localY, localZ: b.localZ }
}

export function serializeFixture(f: Fixture): SerializedFixture {
  return {
    _type: 'fixture',
    id: f.id,
    name: f.name,
    startAddress: f.startAddress,
    fixturePosition: { ...f.fixturePosition },
    fixtureSize: { ...f.fixtureSize },
    rotation: f.rotation,
    positionZ: f.positionZ,
    tiltX: f.tiltX,
    rollZ: f.rollZ,
    lensDegreesMinMax: f.lensDegreesMinMax ? [...f.lensDegreesMinMax] : undefined,
    manufacturer: f.manufacturer,
    fixtureType: f.fixtureType,
    oflKey: f.oflKey,
    channels: f.channels.map(serializeChannel),
    beams: f.beams.map(serializeBeam),
    kind: f.kind ? cloneJson(f.kind) : undefined,
    extensionData: f.extensionData ? cloneJson(f.extensionData) : undefined,
  }
}

export function serializeNode(node: SceneNode): SerializedNode {
  if (node instanceof FixtureGroup) {
    return {
      _type: 'group',
      id: node.id,
      name: node.name,
      expanded: node.expanded,
      children: node.children.map(serializeNode),
    }
  }
  return serializeFixture(node as Fixture)
}

export function serializeProject(
  sceneNodes: SceneNode[],
  savedPresets: Preset[],
  pinnedModifiers: PinnedModifier[],
  globalBases: Record<string, number>,
  modifiers: ModifierInstance[],
  livePages: LivePage[] = [],
  liveControllers: string[] = [],
  selectedPresetId: string | null = null,
  globalBpm: number = 120,
  clockEpoch: number = Date.now(),
  activeSectionMembers: Record<string, string[]> = {},
  savedPositions: MovingHeadPosition[] = [],
  requires: ProjectRequirement[] = [],
  extensionData: Record<string, Record<string, unknown>> | undefined = undefined,
): ProjectSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    sceneNodes: sceneNodes.map(serializeNode),
    savedPresets: JSON.parse(JSON.stringify(savedPresets)),
    pinnedModifiers: JSON.parse(JSON.stringify(pinnedModifiers)),
    globalBases: { ...globalBases },
    modifiers: JSON.parse(JSON.stringify(modifiers)),
    livePages: JSON.parse(JSON.stringify(livePages)),
    liveControllers: JSON.parse(JSON.stringify(liveControllers)),
    savedPositions: JSON.parse(JSON.stringify(savedPositions)),
    selectedPresetId,
    globalBpm,
    clockEpoch,
    activeSectionMembers,
    requires: requires.map(r => ({ ...r })),
    extensionData: extensionData ? cloneJson(extensionData) : undefined,
  }
}

// ─── Deserialization ──────────────────────────────────────────────────────────

/**
 * Migrates channels from snapshots that predate the photometric render model:
 * color wheels used to be role 'COLOR' with a white colorValue (making brightness
 * scale with the wheel position) and strobe channels were role 'NONE' (ignored).
 */
function migrateLegacyChannel(data: SerializedChannel): { role: Channel['role']; renderInfo?: ChannelRenderInfo } {
  if (data.renderInfo) return { role: data.role, renderInfo: data.renderInfo }

  if ((data.type === 'COLOR_WHEEL' || data.type === 'COLOR_PRESET' || data.type === 'COLOR_TEMPERATURE') && data.role === 'COLOR') {
    return {
      role: 'COLOR_WHEEL',
      renderInfo: { ranges: [{ kind: 'color', min: 0, max: 255, rgb: [255, 255, 255] }] },
    }
  }
  if (data.type === 'STROBE' && data.role === 'NONE') {
    return {
      role: 'SHUTTER',
      renderInfo: { ranges: [{ kind: 'shutter', min: 0, max: 255, freqStart: 0, freqEnd: 0 }] },
    }
  }
  return { role: data.role }
}

function deserializeChannel(data: SerializedChannel): Channel {
  const migrated = migrateLegacyChannel(data)
  return {
    type: data.type,
    addressOffset: data.addressOffset,
    resolution: data.resolution,
    fineAddressOffsets: data.fineAddressOffsets,
    isFine: data.isFine,
    role: migrated.role,
    renderInfo: migrated.renderInfo,
    colorValue: data.colorValue,
    oflChannelName: data.oflChannelName,
    defaultValue: data.defaultValue,
    rangeMin: data.rangeMin ?? 0,
    rangeMax: data.rangeMax ?? 255,
    beamId: data.beamId,
    chaserConfig: reactive(JSON.parse(JSON.stringify(data.chaserConfig))),
  }
}

export function deserializeFixture(data: SerializedFixture): Fixture {
  const f = new Fixture(data.id, [], data.startAddress)
  f.name = data.name
  f.fixturePosition = { ...data.fixturePosition }
  f.fixtureSize = { ...data.fixtureSize }
  f.rotation = data.rotation
  f.positionZ = data.positionZ ?? 0
  f.tiltX = data.tiltX ?? 0
  f.rollZ = data.rollZ ?? 0
  f.lensDegreesMinMax = data.lensDegreesMinMax ? [...data.lensDegreesMinMax] : undefined
  f.manufacturer = data.manufacturer
  f.fixtureType = data.fixtureType
  f.oflKey = data.oflKey
  f.channels = data.channels.map(deserializeChannel)
  f.beams = data.beams.map(b => new Beam(b.id, b.localX, b.localY, b.localZ ?? 0))

  if (data.extensionData) f.extensionData = cloneJson(data.extensionData)
  if (data.kind) {
    // Rebuild from config (migrates older config versions); falls back to the
    // compiled cache when the kind's extension is not installed.
    f.kind = cloneJson(data.kind)
    rebuildKindFixture(f)
  }
  return f
}

function deserializeNode(data: SerializedNode, parent: FixtureGroup | null = null): SceneNode {
  if (data._type === 'group') {
    const group = new FixtureGroup(data.id, data.name)
    group.expanded = data.expanded
    group.parent = parent
    group.children = data.children.map(child => deserializeNode(child, group))
    return group
  }
  const fixture = deserializeFixture(data as SerializedFixture)
  fixture.parent = parent
  return fixture
}

export function deserializeProject(snapshot: ProjectSnapshot): {
  sceneNodes: SceneNode[]
  savedPresets: Preset[]
  pinnedModifiers: PinnedModifier[]
  globalBases: Record<string, number>
  modifiers: ModifierInstance[]
  livePages: LivePage[]
  selectedPresetId: string | null
  globalBpm: number
  clockEpoch: number
  activeSectionMembers: Record<string, string[]>
  savedPositions: MovingHeadPosition[]
  requires: ProjectRequirement[]
  extensionData: Record<string, Record<string, unknown>> | undefined
} {
  if (snapshot?.schemaVersion !== SCHEMA_VERSION) throw new IncompatibleProjectError(snapshot?.schemaVersion)
  return {
    sceneNodes: snapshot.sceneNodes.map(n => deserializeNode(n, null)),
    savedPresets: JSON.parse(JSON.stringify(snapshot.savedPresets)),
    pinnedModifiers: JSON.parse(JSON.stringify(snapshot.pinnedModifiers)),
    // Dimmers always start off; ignore any persisted DIMMER base from older projects.
    globalBases: { ...snapshot.globalBases, DIMMER: 0 },
    modifiers: cloneModifiers(snapshot.modifiers ?? []),
    livePages: JSON.parse(JSON.stringify(snapshot.livePages ?? [])),
    selectedPresetId: snapshot.selectedPresetId ?? null,
    globalBpm: snapshot.globalBpm ?? 120,
    clockEpoch: snapshot.clockEpoch ?? Date.now(),
    activeSectionMembers: snapshot.activeSectionMembers ?? {},
    savedPositions: JSON.parse(JSON.stringify(snapshot.savedPositions ?? [])),
    requires: (snapshot.requires ?? []).map(r => ({ ...r })),
    extensionData: snapshot.extensionData ? cloneJson(snapshot.extensionData) : undefined,
  }
}
