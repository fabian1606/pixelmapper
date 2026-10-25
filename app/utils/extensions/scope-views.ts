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
  FixtureSummary,
  Json,
} from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { FixtureGroup } from '~/utils/engine/core/group';
import type { ModifierInstance, ChannelType } from '~/utils/engine/types';
import { modifierName } from '~/utils/engine/modifiers';
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

/** Light fixture list for the project scope. */
export function fixtureSummaries(fixtures: readonly Fixture[]): FixtureSummary[] {
  void modelTick.value;
  return fixtures.map((f) => {
    const summary: FixtureSummary = { id: f.id, name: f.name, startAddress: f.startAddress, channelCount: f.channels.length, kindId: f.kind?.id };
    // Copied (views are frozen in dev), only when present (API 1.4).
    if (f.extensionData) summary.extensionData = jsonClone(f.extensionData) as Record<string, Record<string, Json>>;
    return summary;
  });
}

/** Projects one fixture (channels, beams, kind/extension data). */
export function fixtureView(fixture: Fixture): FixtureView {
  void modelTick.value; // re-project on non-reactive model changes
  const beams: BeamView[] = fixture.beams.map(b => ({ id: b.id, x: b.localX, y: b.localY, z: b.localZ }));
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
    source: fixture.source ? { key: fixture.source.key, modeIndex: fixture.source.modeIndex } : undefined,
    channels: fixture.channels.map((_, i) => channelView(fixture, i)),
    beams,
    kind: fixture.kind ? { id: fixture.kind.id, version: fixture.kind.version, config: jsonClone(fixture.kind.config) as Json } : undefined,
    extensionData: fixture.extensionData ? jsonClone(fixture.extensionData) as Record<string, Record<string, Json>> : undefined,
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

/** Deprecated v2 direction fields derived from the distribution (ADR A20). */
function legacyDirection(m: ModifierInstance): Pick<ModifierInstanceView, 'direction' | 'originX' | 'originY' | 'angle' | 'fanning' | 'reverse'> {
  const d = m.distribution;
  const dx = d.end.x - d.origin.x;
  const dy = d.end.y - d.origin.y;
  const byMode: Partial<Record<string, ModifierInstanceView['direction']>> = { linear: 'LINEAR', radial: 'RADIAL', conical: 'ANGULAR' };
  const direction = byMode[d.mode] ?? 'NONE';
  return {
    direction,
    originX: d.origin.x,
    originY: d.origin.y,
    angle: Math.atan2(dy, dx),
    fanning: direction === 'NONE' ? 0 : Math.hypot(dx, dy),
    reverse: d.reverse,
  };
}

/** Projects a modifier instance into its scope view. */
export function modifierView(m: ModifierInstance): ModifierInstanceView {
  return {
    id: m.id,
    plugin: m.plugin,
    name: modifierName(m),
    signature: m.signature,
    targetChannels: [...m.targetChannels],
    targetFixtureIds: m.targetFixtureIds ? [...m.targetFixtureIds] : undefined,
    blendMode: m.blendMode,
    strength: m.strength,
    speed: { ...m.speed },
    distribution: jsonClone(m.distribution) as ModifierInstanceView['distribution'],
    ...legacyDirection(m),
    params: jsonClone(m.params) as ModifierInstanceView['params'],
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
