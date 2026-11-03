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

export type LiveMappingType = 'preset' | 'channel' | 'effect-param' | 'page-switch' | 'global-function' | 'dimmer-group' | 'position-recall' | 'speed' | 'master-dimmer' | 'none'

/**
 * How a `speed` fader maps onto the speed multiplier (see utils/live/speed-fader.ts):
 * `continuous` = ½×–2× around 1× in the center; `steps` = snaps to ¼×, ½×, 1×, 2×, 4×.
 */
export type SpeedFaderMode = 'continuous' | 'steps'

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

/**
 * `stop-all` is instant: clears preset, flashes, overwrites, toggles and speed.
 * `step-back` is instant: returns to the look before the last lasting change (live-history).
 * `tap-tempo` ("Beat") is instant: one tap of the tap tempo (live-ops/tap-tempo).
 * `speed-double` / `speed-half` are instant: current speed ×2 / ÷2 (¼×–4×);
 * `speed-reset` is instant: back to 1× (the tapped BPM), latched speed buttons off.
 */
export type GlobalFunctionType = 'strobe' | 'blind' | 'blackout' | 'speed' | 'stop-all' | 'step-back' | 'tap-tempo'
  | 'speed-double' | 'speed-half' | 'speed-reset'

export interface StrobeConfig {
  frequency: number
  beatSync: boolean
  beatDivision: number
}

export interface BlindConfig {
  color: string
  dimmerCurve: boolean
}

/** Button behavior: 'latch' toggles on each press, 'hold' is active only while held (momentary). */
export type ButtonBehavior = 'hold' | 'latch'

export interface SpeedConfig {
  multiplier: number
  behavior: ButtonBehavior
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
  /** Buttons on a bool param: toggle per press ('latch', default) or on while held ('hold'). */
  behavior?: ButtonBehavior
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
  // speed (faders only); absent = 'continuous'
  speedMode?: SpeedFaderMode
}

// ── Button actions ────────────────────────────────────────────────────────────

/** When a button action fires. */
export type ButtonTrigger = 'press' | 'double' | 'long' | 'hold' | 'release' | 'toggle';

/** MIDI note or controller (address of the `midi` input source). */
export interface MidiTrigger {
  type: 'note' | 'cc';
  /** MIDI channel 1–16. */
  channel: number;
  /** Note or controller number 0–127. */
  number: number;
}

/** How long a fired action lasts (only for press / double / long / release). */
export type ActionDuration =
  | { mode: 'forever' }
  | { mode: 'beats'; beats: number }
  | { mode: 'time'; ms: number }
  /** One pass of the preset's slowest modifier (presets only). */
  | { mode: 'once' };

/** How long a long press must be held. */
export type HoldTime = { mode: 'beats'; beats: number } | { mode: 'time'; ms: number };

/** One step of a button's script: trigger → action → duration. */
export interface ButtonAction {
  id: string;
  trigger: ButtonTrigger;
  /** Reuses the mapping shape (preset, global function, page switch, …). */
  action: LiveMapping;
  /** Absent = forever. Ignored for hold / toggle and instant actions. */
  duration?: ActionDuration;
  /** Required hold time for trigger === 'long'. Absent = 1 s. */
  hold?: HoldTime;
  /** Set once the user picked the trigger, so smart defaults stop overriding it. */
  triggerTouched?: boolean;
}

/**
 * One outside input that presses a button like a click / pad hit (a key, a
 * MIDI note, a Stream Deck key, …): down presses, up releases, so every
 * trigger works. `source` names the `InputSource` (`utils/live/inputs/`),
 * `address` is that source's own value, e.g. `"KeyB"` or a `MidiTrigger`.
 */
export interface InputBinding {
  source: string;
  address: unknown;
}

/** How a button looks while active. */
export type ButtonActiveLook = 'full' | 'blink' | 'pulse';
/** How a button looks while inactive. */
export type ButtonInactiveLook = 'dim' | 'off' | 'full';

/** Look of a button on the canvas and of its controller LED. Absent fields = defaults (full / dim). */
export interface ButtonAppearance {
  active?: ButtonActiveLook;
  inactive?: ButtonInactiveLook;
}

/**
 * Per-control mapping override stored inside a controller-twin widget.
 * Children are NOT canvas widgets — they are mapping records keyed by a
 * controlId from the controller definition's `controls[]`.
 */
export interface ControllerChildBinding {
  controlId: string
  label?: string
  /** Own color; absent = derived from the first preset action. */
  color?: string
  /** Fader mapping. Pads use `actions` instead. */
  mapping: LiveMapping
  /** Pad script (pads only). */
  actions?: ButtonAction[]
  appearance?: ButtonAppearance
  /** Outside inputs that also press this pad. */
  inputs?: InputBinding[]
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
  /** Slider mapping. Buttons use `actions` instead. */
  mapping: LiveMapping
  /** Button script (button widgets only). */
  actions?: ButtonAction[]
  appearance?: ButtonAppearance
  /** Outside inputs that also press this button. */
  inputs?: InputBinding[]
  // controller-twin specific
  controllerKey?: string
  /** ID of the specific LiveControllerInstance this twin is bound to. */
  controllerInstanceId?: string
  controllerChildren?: ControllerChildBinding[]
  // Flat group association: widgets sharing the same groupId are grouped.
  groupId?: string
  /** Namespaced extension data (ADR §5.8): `extensionData[extensionId][key]`. */
  extensionData?: Record<string, Record<string, unknown>>
}

export type SectionSource = 'all-presets' | 'selected-presets' | 'preset-variants' | 'color-variants'
/**
 * How a section button reacts. Exactly one member is active at a time,
 * because only one preset can be active:
 * - press: pressed button becomes active (stays)
 * - hold: active while held, then back to the previous preset
 * - toggle: like press; pressing the lit button again goes back
 */
export type SectionTrigger = 'press' | 'hold' | 'toggle'

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
  /** Absent = 'press'. */
  trigger?: SectionTrigger
  members: SectionMember[]
  /** Shared color for all members; empty / absent = each slot's preset color. */
  color?: string
  /** Shared look for all members. */
  appearance?: ButtonAppearance
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
    // A button always starts with one "On press" action; the user picks what it does.
    ...(type === 'button' ? { actions: [defaultButtonAction()] } : {}),
  }
}

/** The action every button starts with: On press, nothing chosen yet. */
export function defaultButtonAction(): ButtonAction {
  return { id: crypto.randomUUID(), trigger: 'press', action: { type: 'none' } }
}
