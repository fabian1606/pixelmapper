export type LiveWidgetType = 'button' | 'slider' | 'xy-pad' | 'controller-twin' | 'label' | 'fixture-preview' | 'color-wheel'

export type ColorWheelScope = 'preset' | 'variant' | 'global'

/** A persisted controller instance: one entry per physical device slot. */
export interface LiveControllerInstance {
  id: string
  definitionKey: string
}

export type LiveMappingType = 'preset' | 'channel' | 'effect-param' | 'page-switch' | 'none'

export interface LiveMapping {
  type: LiveMappingType
  // preset
  presetId?: string
  // channel
  fixtureId?: string | number
  channelOffset?: number
  // effect-param
  effectId?: string
  paramKey?: string
  // page-switch
  targetPageId?: string
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
  // color-wheel specific
  colorWheelScope?: ColorWheelScope
}

export type SectionSource = 'all-presets' | 'preset-variants'
export type SectionMode = 'flash' | 'single-select' | 'multi-select'

export interface SectionMember {
  widgetId: string
  // For controller-twin members, identifies which sub-control on the twin.
  controlId?: string
}

export interface LiveSection {
  id: string
  name?: string
  source: SectionSource
  mode: SectionMode
  members: SectionMember[]
  /** When enabled, hue values are auto-distributed evenly across section slots. */
  autoColors?: boolean
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

export function defaultLiveWidget(type: LiveWidgetType, gridX = 0, gridY = 0): LiveWidget {
  const sizes: Record<LiveWidgetType, [number, number]> = {
    button: [3, 3],
    slider: [2, 6],
    'xy-pad': [6, 6],
    'controller-twin': [12, 8],
    label: [4, 1],
    'fixture-preview': [12, 8],
    'color-wheel': [12, 5],
  };
  const [w, h] = sizes[type];
  return {
    id: crypto.randomUUID(),
    type,
    gridX,
    gridY,
    gridW: w,
    gridH: h,
    mapping: { type: 'none' },
  };
}
