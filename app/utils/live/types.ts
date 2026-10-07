/** Live widget types shipped by the core (ADR §5.7). `controller-twin` moves to the controller extensions in plan P6.4. */
export type CoreLiveWidgetType = 'button' | 'slider' | 'xy' | 'color' | 'label' | 'beat' | 'fixture-preview' | 'controller-twin'

/** Any live widget type: core, or `<extensionId>/<name>` from an extension. */
export type LiveWidgetType = CoreLiveWidgetType | `${string}/${string}`

/** Pre-dedupe type names (plan P2.3) and their replacements. */
const LEGACY_WIDGET_TYPES: Record<string, CoreLiveWidgetType> = {
  'xy-pad': 'xy',
  'color-wheel': 'color',
}

/** Maps legacy widget type names to their current name (no-op otherwise). */
export function normalizeWidgetType(type: string): LiveWidgetType {
  return (LEGACY_WIDGET_TYPES[type] ?? type) as LiveWidgetType
}

/** Normalizes widget types of a page in place (used when loading pages / replaying). */
export function normalizePageWidgetTypes(page: LivePage): LivePage {
  for (const w of page.widgets) w.type = normalizeWidgetType(w.type)
  return page
}

/** A persisted controller instance: one entry per physical device slot. */
export interface LiveControllerInstance {
  id: string
  definitionKey: string
}

export type LiveMappingType = 'preset' | 'channel' | 'effect-param' | 'page-switch' | 'global-function' | 'dimmer-group' | 'position-recall' | 'none'

export interface MovingHeadPosition {
  id: string
  name: string
  snapshot: Array<{
    fixtureId: string | number
    channelOffset: number
    channelType: string
    value: number
  }>
}

export type GlobalFunctionType = 'strobe' | 'blind' | 'blackout' | 'speed'

export interface StrobeConfig {
  frequency: number
  beatSync: boolean
  beatDivision: number
}

export interface BlindConfig {
  color: string
  dimmerCurve: boolean
}

export interface SpeedConfig {
  multiplier: number
  behavior: 'hold' | 'latch'
}

export type GlobalFunctionConfig = StrobeConfig | BlindConfig | SpeedConfig | Record<string, never>

export function defaultStrobeConfig(): StrobeConfig {
  return { frequency: 8, beatSync: false, beatDivision: 8 }
}

export function defaultBlindConfig(): BlindConfig {
  return { color: '#ffffff', dimmerCurve: false }
}

export function defaultSpeedConfig(): SpeedConfig {
  return { multiplier: 2, behavior: 'latch' }
}

export interface LiveMapping {
  type: LiveMappingType
  // preset
  presetId?: string
  // channel
  fixtureId?: string | number
  channelOffset?: number
  channelType?: string  // used when targeting a group (all fixtures with this channel type)
  // effect-param
  effectId?: string
  paramKey?: string
  // page-switch
  targetPageId?: string
  // global-function
  globalFunction?: GlobalFunctionType
  globalFunctionConfig?: GlobalFunctionConfig
  // dimmer-group
  groupId?: string | number
  fixtureIds?: (string | number)[]
  // position-recall
  positionId?: string
}

/**
 * Per-control mapping override stored inside a controller-twin widget.
 * Children are NOT canvas widgets — they are mapping records keyed by a
 * controlId from the controller definition's `controls[]`.
 */
export interface ControllerChildBinding {
  controlId: string
  label?: string
  color?: string
  mapping: LiveMapping
}

export interface LiveWidget {
  id: string
  type: LiveWidgetType
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  label?: string
  color?: string
  mapping: LiveMapping
  // controller-twin specific
  controllerKey?: string
  /** ID of the specific LiveControllerInstance this twin is bound to. */
  controllerInstanceId?: string
  controllerChildren?: ControllerChildBinding[]
  // Flat group association: widgets sharing the same groupId are grouped.
  groupId?: string
}

export type SectionSource = 'all-presets' | 'selected-presets' | 'preset-variants' | 'color-variants'
export type SectionMode = 'flash' | 'single-select' | 'multi-select'

export interface SectionMember {
  widgetId: string
  // For controller-twin members, identifies which sub-control on the twin.
  controlId?: string
}

/** A persisted color for a 'color-variants' section slot. `null` = use the active preset's natural color. */
export type SectionColorEntry = { r: number; g: number; b: number } | null

export interface LiveSection {
  id: string
  name?: string
  source: SectionSource
  mode: SectionMode
  members: SectionMember[]
  /**
   * For source === 'selected-presets': an ordered, user-curated list of preset
   * IDs. Slot order follows this list (filtered to presets that still exist),
   * mapping onto the section's members by canvas position.
   */
  selectedPresetIds?: string[]
  /**
   * For source === 'color-variants': one entry per ordered member slot.
   * Slot 0 is always `null` (mirrors the active preset's natural RGB).
   * Other slots hold a fixed RGB chosen by auto-generation or user edit.
   */
  colorVariants?: SectionColorEntry[]
}

export interface LivePage {
  id: string
  name: string
  columns: number
  aspectRatioW: number
  aspectRatioH: number
  gridSize: number
  backgroundColor: string
  widgets: LiveWidget[]
  sections?: LiveSection[]
}

/** Pixel dimensions derived from columns × gridSize and aspect ratio. */
export function getPageResolution(page: LivePage): { w: number; h: number } {
  const w = page.columns * page.gridSize;
  const h = Math.round(w * page.aspectRatioH / page.aspectRatioW);
  return { w, h };
}

export function defaultLivePage(overrides: Partial<LivePage> = {}): LivePage {
  return {
    id: crypto.randomUUID(),
    name: 'Page 1',
    columns: 60,
    aspectRatioW: 16,
    aspectRatioH: 9,
    gridSize: 32,
    backgroundColor: '#0a0a0a',
    widgets: [],
    ...overrides,
  };
}

/** Default grid footprint of the core widget types. */
export const CORE_WIDGET_SIZES: Record<CoreLiveWidgetType, [number, number]> = {
  button: [3, 3],
  slider: [2, 6],
  xy: [6, 6],
  'controller-twin': [12, 8],
  label: [4, 1],
  'fixture-preview': [12, 8],
  color: [12, 5],
  beat: [4, 3],
}

/**
 * Creates a widget of `type` at a grid position. `size` overrides the core
 * default footprint (extension widgets pass their definition's size).
 */
export function defaultLiveWidget(type: LiveWidgetType, gridX = 0, gridY = 0, size?: [number, number]): LiveWidget {
  const [w, h] = size ?? CORE_WIDGET_SIZES[type as CoreLiveWidgetType] ?? [4, 4]
  return {
    id: crypto.randomUUID(),
    type,
    gridX,
    gridY,
    gridW: w,
    gridH: h,
    mapping: { type: 'none' },
  }
}
