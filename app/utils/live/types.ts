export type LiveWidgetType = 'button' | 'slider' | 'xy-pad' | 'controller-twin' | 'label'

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
  controllerWidgets?: LiveWidget[]
  // Flat group association: widgets sharing the same groupId are grouped.
  groupId?: string
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
