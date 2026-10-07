/**
 * Readonly scope projections (ADR §5.2).
 *
 * Converts core model instances (classes with mutation methods, reactive
 * objects) into plain view objects of the extension API. Views are fresh
 * objects, so freezing them never affects core state.
 */
import { toRaw } from 'vue';
import type {
  BeamView,
  ChannelView,
  FixtureView,
  LivePageView,
  LiveWidgetView,
  ModifierInstanceView,
  PresetView,
  SelectionInfo,
  SignatureTarget,
  ViewportMode,
  ViewportInfo,
  ChannelRef,
  Json,
  BlendMode,
} from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { FixtureGroup } from '~/utils/engine/core/group';
import type { Effect, ChannelType } from '~/utils/engine/types';
import type { Preset } from '~/utils/engine/preset-types';
import type { LivePage, LiveWidget } from '~/utils/live/types';
import { modelTick } from './model-tick';

// ── Freezing ────────────────────────────────────

/** True in dev builds and tests; production skips freezing for speed. */
const FREEZE = import.meta.env?.DEV ?? true;

/** Recursively freezes plain objects/arrays. Typed arrays are left alone. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Freezes a view in dev so any mutation attempt by an extension throws a
 * `TypeError` (ES modules run in strict mode). No-op in production.
 *
 * Operates on the raw object (a reactive proxy cannot be frozen through), so
 * the source MUST yield fresh view objects owned by the provider — never core
 * model state. Vue leaves frozen objects un-proxied afterwards.
 */
export function freezeView<T>(value: T): T {
  const raw = toRaw(value);
  return FREEZE ? deepFreeze(raw) : raw;
}

/**
 * Deep copy of JSON data. Unlike `structuredClone` it works on Vue reactive
 * proxies (mappings, extension data, params live in reactive state).
 */
function jsonClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

// ── Global scopes ───────────────────────────────

/** Expands selected node ids into fixture ids (groups → their fixtures). */
export function selectionView(selectedIds: ReadonlySet<string | number>, sceneNodes: readonly SceneNode[]): SelectionInfo {
  const fixtureIds: (string | number)[] = [];
  const visit = (nodes: readonly SceneNode[], inSelected: boolean) => {
    for (const node of nodes) {
      const selected = inSelected || selectedIds.has(node.id);
      if (node instanceof FixtureGroup) visit(node.children, selected);
      else if (selected) fixtureIds.push(node.id);
    }
  };
  visit(sceneNodes, false);
  return { fixtureIds, nodeIds: [...selectedIds] };
}

/** Viewport mode as used by the project page's mode switcher. */
export type PageViewportMode = 'raw' | '2d' | '3d';

/** Maps the page-level viewport (plus route context) to the API mode. */
export function viewportView(pageMode: PageViewportMode, routePath: string): ViewportInfo {
  let mode: ViewportMode;
  if (/\/live\/?$/.test(routePath)) mode = 'live';
  else if (pageMode === 'raw') mode = 'design';
  else mode = pageMode;
  return { mode };
}

// ── Fixture / channel ───────────────────────────

/** Projects one channel of a fixture. */
export function channelView(fixture: Fixture, index: number): ChannelView {
  void modelTick.value; // re-project on non-reactive model changes
  const ch = fixture.channels[index]!;
  const cfg = ch.chaserConfig;
  const value = cfg?.stepValues?.[cfg.activeEditStep] ?? cfg?.stepValues?.[0] ?? ch.defaultValue;
  return {
    fixtureId: fixture.id,
    index,
    type: ch.type,
    role: ch.role,
    name: ch.oflChannelName,
    addressOffset: ch.addressOffset,
    dmxAddress: fixture.startAddress + ch.addressOffset,
    resolution: ch.resolution ?? 1,
    fineAddressOffsets: [...(ch.fineAddressOffsets ?? [])],
    isFine: ch.isFine ?? false,
    rangeMin: ch.rangeMin ?? 0,
    rangeMax: ch.rangeMax ?? 255,
    defaultValue: ch.defaultValue,
    colorValue: ch.colorValue,
    beamId: ch.beamId,
    value,
    capabilities: ch.oflCapabilities?.map(cap => ({
      dmxRange: [...(cap.dmxRange ?? [0, 255])] as [number, number],
      type: String(cap.type),
      comment: cap.comment,
    })),
  };
}

/** Projects one fixture (channels, beams, kind/extension data). */
export function fixtureView(fixture: Fixture): FixtureView {
  void modelTick.value; // re-project on non-reactive model changes
  const beams: BeamView[] = fixture.beams.map(b => ({ id: b.id, x: b.localX, y: b.localY, z: b.localZ }));
  const extra = fixture as Fixture & {
    kind?: { id: string; version: string; config: Json };
    extensionData?: Record<string, Record<string, Json>>;
  };
  return {
    id: fixture.id,
    name: fixture.name,
    startAddress: fixture.startAddress,
    universe: fixture.universe,
    localAddress: fixture.localAddress,
    position: { x: fixture.fixturePosition.x, y: fixture.fixturePosition.y },
    size: { x: fixture.fixtureSize.x, y: fixture.fixtureSize.y },
    rotation: fixture.rotation,
    positionZ: fixture.positionZ,
    manufacturer: fixture.manufacturer,
    fixtureType: fixture.fixtureType,
    oflKey: fixture.oflKey,
    channels: fixture.channels.map((_, i) => channelView(fixture, i)),
    beams,
    kind: extra.kind ? jsonClone(extra.kind) : undefined,
    extensionData: extra.extensionData ? jsonClone(extra.extensionData) : undefined,
  };
}

// ── Signatures ──────────────────────────────────

/** Channel type order of RGB-family signature components. */
const RGB_TYPES: ChannelType[] = ['RED', 'GREEN', 'BLUE'];

/**
 * Resolves the signature target a set of channels forms. `beamId` restricts
 * the lookup to one head of a multi-head fixture.
 *
 * - `rgb` when RED, GREEN and BLUE exist,
 * - `panTilt` when PAN and TILT exist,
 * - otherwise `scalar` over the given channel.
 */
export function signatureTargetFor(fixture: Fixture, channelIndex: number): SignatureTarget {
  const ch = fixture.channels[channelIndex]!;
  const sameHead = (i: number) => fixture.channels[i]!.beamId === ch.beamId && !fixture.channels[i]!.isFine;
  const find = (type: ChannelType): ChannelRef | null => {
    const i = fixture.channels.findIndex((c, idx) => c.type === type && sameHead(idx));
    return i >= 0 ? { channelIndex: i, type } : null;
  };

  if (RGB_TYPES.includes(ch.type)) {
    const refs = RGB_TYPES.map(find);
    if (refs.every(Boolean)) return { signature: 'rgb', fixtureId: fixture.id, channelRefs: refs as ChannelRef[] };
  }
  if (ch.type === 'PAN' || ch.type === 'TILT') {
    const pan = find('PAN');
    const tilt = find('TILT');
    if (pan && tilt) return { signature: 'panTilt', fixtureId: fixture.id, channelRefs: [pan, tilt] };
  }
  return { signature: 'scalar', fixtureId: fixture.id, channelRefs: [{ channelIndex, type: ch.type }] };
}

// ── Modifiers ───────────────────────────────────

/** Legacy effect → built-in plugin id until the modifier rebuild (plan P3). */
function legacyPluginOf(effect: Effect): { plugin: string; name: string; params: Record<string, unknown> } {
  if (effect.colorParams) return { plugin: 'builtin:color-adjust', name: 'Color', params: { ...effect.colorParams } };
  if (effect.sequencerParams) return { plugin: 'builtin:sequencer', name: 'Sequencer', params: { ...effect.sequencerParams } };
  if (effect.noiseParams) return { plugin: 'builtin:noise', name: 'Noise', params: { ...effect.noiseParams } };
  if (effect.displacementParams) return { plugin: 'builtin:displacement', name: 'Displacement', params: { ...effect.displacementParams } };
  if (effect.speedCurveParams) return { plugin: 'builtin:speed-curve', name: 'Speed Curve', params: { ...effect.speedCurveParams } };
  return {
    plugin: 'builtin:waveform',
    name: 'Waveform',
    params: { shape: effect.waveformShape ?? 'sine', ...(effect.waveformParams ?? {}) },
  };
}

/** Projects a (legacy) effect into a modifier instance view. */
export function modifierView(effect: Effect, blendMode: BlendMode): ModifierInstanceView {
  const { plugin, name, params } = legacyPluginOf(effect);
  return {
    id: effect.id,
    plugin,
    name,
    signature: effect.colorParams ? 'rgb' : 'scalar',
    targetChannels: [...effect.targetChannels],
    targetFixtureIds: effect.targetFixtureIds ? [...effect.targetFixtureIds] : undefined,
    blendMode,
    strength: effect.strength / 100,
    speed: { ...effect.speed },
    direction: effect.direction ?? 'NONE',
    originX: effect.originX ?? 0.5,
    originY: effect.originY ?? 0.5,
    angle: effect.angle ?? 0,
    fanning: effect.fanning,
    reverse: effect.reverse ?? false,
    params: jsonClone(params) as ModifierInstanceView['params'],
  };
}

// ── Presets / live ──────────────────────────────

/** Projects a preset. */
export function presetView(preset: Preset): PresetView {
  const fixtureIds = new Set<string | number>();
  for (const cat of preset.categories ?? []) for (const id of cat.fixtureIds) fixtureIds.add(id);
  return { id: preset.id, name: preset.name, type: preset.type ?? 'normal', fixtureIds: [...fixtureIds] };
}

/** Projects a live widget. */
export function liveWidgetView(widget: LiveWidget): LiveWidgetView {
  const extra = widget as LiveWidget & { extensionData?: Record<string, Record<string, Json>> };
  return {
    id: widget.id,
    type: widget.type,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    label: widget.label,
    color: widget.color,
    mapping: jsonClone(widget.mapping) as unknown as Record<string, Json>,
    extensionData: extra.extensionData ? jsonClone(extra.extensionData) : undefined,
  };
}

/** Projects a live page. */
export function livePageView(page: LivePage): LivePageView {
  return { id: page.id, name: page.name, columns: page.columns, widgetIds: page.widgets.map(w => w.id) };
}
