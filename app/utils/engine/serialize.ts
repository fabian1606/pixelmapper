import { Fixture } from './core/fixture'
import { FixtureGroup, type SceneNode } from './core/group'
import type { Channel } from './core/channel'
import { Beam } from './core/beam'
import type { Preset } from './preset-types'
import type { Effect } from './types'
import type { PinnedModifier } from '~/stores/pinned-modifiers-store'
import { reactive } from 'vue'

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
  beamId?: string
  chaserConfig: any
}

export interface SerializedBeam {
  id: string
  localX: number
  localY: number
}

export interface SerializedFixture {
  _type: 'fixture'
  id: string | number
  name: string
  startAddress: number
  fixturePosition: { x: number; y: number }
  fixtureSize: { x: number; y: number }
  rotation: number
  manufacturer: string
  fixtureType: string
  oflKey?: string
  channels: SerializedChannel[]
  beams: SerializedBeam[]
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
  sceneNodes: SerializedNode[]
  savedPresets: Preset[]
  pinnedModifiers: PinnedModifier[]
  globalBases: Record<string, number>
  activeEffects: Effect[]
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
    beamId: ch.beamId,
    chaserConfig: JSON.parse(JSON.stringify(ch.chaserConfig)),
  }
}

function serializeBeam(b: Beam): SerializedBeam {
  return { id: b.id, localX: b.localX, localY: b.localY }
}

function serializeFixture(f: Fixture): SerializedFixture {
  return {
    _type: 'fixture',
    id: f.id,
    name: f.name,
    startAddress: f.startAddress,
    fixturePosition: { ...f.fixturePosition },
    fixtureSize: { ...f.fixtureSize },
    rotation: f.rotation,
    manufacturer: f.manufacturer,
    fixtureType: f.fixtureType,
    oflKey: f.oflKey,
    channels: f.channels.map(serializeChannel),
    beams: f.beams.map(serializeBeam),
  }
}

function serializeNode(node: SceneNode): SerializedNode {
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
  activeEffects: Effect[],
): ProjectSnapshot {
  return {
    sceneNodes: sceneNodes.map(serializeNode),
    savedPresets: JSON.parse(JSON.stringify(savedPresets)),
    pinnedModifiers: JSON.parse(JSON.stringify(pinnedModifiers)),
    globalBases: { ...globalBases },
    activeEffects: JSON.parse(JSON.stringify(activeEffects)),
  }
}

// ─── Deserialization ──────────────────────────────────────────────────────────

function deserializeChannel(data: SerializedChannel): Channel {
  return {
    type: data.type,
    addressOffset: data.addressOffset,
    resolution: data.resolution,
    fineAddressOffsets: data.fineAddressOffsets,
    isFine: data.isFine,
    role: data.role,
    colorValue: data.colorValue,
    oflChannelName: data.oflChannelName,
    defaultValue: data.defaultValue,
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
  f.manufacturer = data.manufacturer
  f.fixtureType = data.fixtureType
  f.oflKey = data.oflKey
  f.channels = data.channels.map(deserializeChannel)
  f.beams = data.beams.map(b => new Beam(b.id, b.localX, b.localY))
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
  activeEffects: Effect[]
} {
  return {
    sceneNodes: snapshot.sceneNodes.map(n => deserializeNode(n, null)),
    savedPresets: JSON.parse(JSON.stringify(snapshot.savedPresets)),
    pinnedModifiers: JSON.parse(JSON.stringify(snapshot.pinnedModifiers)),
    globalBases: { ...snapshot.globalBases },
    activeEffects: JSON.parse(JSON.stringify(snapshot.activeEffects)),
  }
}
