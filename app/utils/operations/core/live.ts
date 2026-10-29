/**
 * Live page operations: `live.listPages`, `live.addPage`, `live.addWidget`,
 * `live.updateWidget`, `live.removeWidget` (ADR 0002 §4.2).
 *
 * They wrap the commands in `live-widget-commands.ts` so an agent can build
 * a performer control page for an effect (sliders bound to modifier params
 * via `effect-param` mappings, buttons for presets / global functions or
 * bool / trigger params, xy pads for point params).
 *
 * Grid: a page is `columns` cells wide (default 60); cells are square, so
 * the visible height is `rows = floor(columns · aspectRatioH / aspectRatioW)`
 * (60 columns at 16:9 → 33 rows). Widget positions/sizes are integer cell
 * units, origin top-left: `gridX` 0…columns-1 left→right, `gridY` top→bottom.
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import {
  AddLivePageCommand,
  AddLiveWidgetCommand,
  MoveResizeLiveWidgetCommand,
  RemoveLiveWidgetCommand,
  UpdateWidgetMappingCommand,
} from '~/components/engine/commands/live-widget-commands';
import type { Command } from '~/components/engine/composables/use-history';
import {
  CORE_WIDGET_SIZES,
  defaultLivePage,
  defaultLiveWidget,
  getPageResolution,
  type LivePage,
  type LiveWidget,
} from '~/utils/live/types';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import type { CoreOperation } from '../registry';
import {
  LIVE_WIDGET_TYPES,
  LiveMappingInputSchema,
  LiveWidgetTypeSchema,
  fromLiveMapping,
  mappingFindings,
  mappingSummary,
  toLiveMapping,
} from './live-mapping';

// ── Shared schemas ──────────────────────────────

/** Grid cell coordinate (integer, ≥ 0). */
const GridCoord = z.number().int().min(0);

/** Grid size in cells (integer, ≥ 1). */
const GridSize = z.number().int().min(1);

/** `#rrggbb` color. */
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb hex color');

/** Grid system explanation shared by the descriptions. */
const GRID_DOC = [
  'Grid: integer cell units, origin top-left. A page is `columns` cells wide (default 60) and `rows = floor(columns · aspectRatioH / aspectRatioW)` cells high (default 16:9 → 33 rows); cells are square.',
  'gridX/gridY = top-left cell (x left→right, y top→bottom), gridW/gridH = size in cells; gridX + gridW must be ≤ columns.',
  `Default sizes (w×h): ${LIVE_WIDGET_TYPES.map(t => `${t} ${CORE_WIDGET_SIZES[t].join('×')}`).join(', ')}.`,
].join('\n');

/** Mapping explanation shared by the descriptions. */
const MAPPING_DOC = [
  'Mappings (field `mapping`, discriminated by `type`):',
  '- effect-param { modifierId, paramKey, behavior? }: drive a modifier value (plugin param keys: see modifiers.list → params, e.g. "count").',
  '  Sliders: "strength" | "speed" | "fanning" | a number/int/bool/trigger param (0–1 maps onto min–max; bools switch at 0.5).',
  '  Buttons: a bool param (behavior "latch" = toggle per press, default; "hold" = true while held) or a trigger param (press/release).',
  '  XY pads: a point param (pad x/y 0–1 → the point\'s x/y).',
  '- channel { fixtureId, channelOffset } or { groupId, channelType }: raw DMX channel. Buttons, sliders, xy (x = channelOffset, y = channelOffset + 1).',
  '- dimmer-group { groupId } or { fixtureId }: dim fixtures. Buttons, sliders.',
  '- preset { presetId }, page-switch { targetPageId }, global-function { function: strobe|blind|blackout|speed, config? }, position-recall { positionId }: buttons only.',
  '- none: no action (color, label, beat, fixture-preview widgets ignore mappings).',
  'A mapping (or effect-param param type) a widget type cannot drive is stored but reported as a warning (mapping-ignored-by-widget).',
].join('\n');

/** Widget view returned by `live.listPages`. */
const LiveWidgetInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().optional(),
  color: z.string().optional(),
  gridX: z.number(),
  gridY: z.number(),
  gridW: z.number(),
  gridH: z.number(),
  mapping: z.record(z.string(), z.unknown()).describe('Mapping in the input shape of live.addWidget (effect-param uses modifierId).'),
  mappingSummary: z.string().describe('One-line summary, e.g. "effect-param: modifier m1 → speed".'),
});

/** Page view returned by `live.listPages`. */
const LivePageInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.number().int().describe('Page width in grid cells.'),
  rows: z.number().int().describe('Visible page height in grid cells.'),
  aspectRatio: z.string().describe('Page aspect ratio, e.g. "16:9".'),
  backgroundColor: z.string(),
  widgets: z.array(LiveWidgetInfoSchema),
});

// ── Helpers ─────────────────────────────────────

/** Visible rows of a page (square cells). */
export function pageRows(page: Pick<LivePage, 'columns' | 'gridSize' | 'aspectRatioW' | 'aspectRatioH'>): number {
  return Math.floor(getPageResolution(page as LivePage).h / page.gridSize);
}

/** Readable "page not found" message. */
function pageNotFound(id: string): string {
  return `live page "${id}" not found (use live.listPages to list ids)`;
}

/** Page by id from the read API. */
function findPage(read: CoreReadApi, pageId: string): LivePage | undefined {
  return read.livePages().find(p => p.id === pageId);
}

/** Page and widget by id; throws readable errors. */
function requireWidget(read: CoreReadApi, pageId: string, widgetId: string): { page: LivePage; widget: LiveWidget } {
  const page = findPage(read, pageId);
  if (!page) throw new Error(pageNotFound(pageId));
  const widget = page.widgets.find(w => w.id === widgetId);
  if (!widget) throw new Error(`widget "${widgetId}" not found on page "${pageId}" (use live.listPages)`);
  return { page, widget };
}

/** True when two grid rectangles overlap. */
function overlaps(a: { x: number; y: number; w: number; h: number }, b: LiveWidget): boolean {
  return a.x < b.gridX + b.gridW && a.x + a.w > b.gridX && a.y < b.gridY + b.gridH && a.y + a.h > b.gridY;
}

/**
 * First free spot for a `w×h` widget: scans rows top→bottom and cells
 * left→right inside the visible page; when nothing fits, places it at the
 * left edge below the lowest widget.
 */
export function findFreeSpot(page: LivePage, w: number, h: number): { x: number; y: number } {
  const rows = pageRows(page);
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= page.columns; x++) {
      if (!page.widgets.some(o => overlaps({ x, y, w, h }, o))) return { x, y };
    }
  }
  return { x: 0, y: page.widgets.reduce((max, o) => Math.max(max, o.gridY + o.gridH), 0) };
}

/** Throws when a rectangle exceeds the page width. */
function assertFitsWidth(page: LivePage, x: number, w: number): void {
  if (x + w > page.columns) throw new Error(`gridX + gridW = ${x + w} exceeds the page width of ${page.columns} columns`);
}

/** Warning when a widget extends below the visible page area. */
function belowPageFinding(page: LivePage, widget: LiveWidget): Finding[] {
  const rows = pageRows(page);
  if (widget.gridY + widget.gridH <= rows) return [];
  return [{
    level: 'warning',
    code: 'widget-below-page',
    message: `widget ends at row ${widget.gridY + widget.gridH} but the page shows ${rows} rows; it is cut off`,
    entityIds: [`liveWidget:${widget.id}`],
  }];
}

/** Postconditions shared by addWidget/updateWidget: widget exists, mapping valid. */
function widgetFindings(read: CoreReadApi, pageId: string, widgetId: string): Finding[] {
  const page = findPage(read, pageId);
  const widget = page?.widgets.find(w => w.id === widgetId);
  if (!page || !widget) {
    return [{ level: 'error', code: 'widget-missing', message: `widget "${widgetId}" is not on page "${pageId}" after the operation`, entityIds: [`liveWidget:${widgetId}`] }];
  }
  if (!(LIVE_WIDGET_TYPES as readonly string[]).includes(widget.type)) {
    return [{ level: 'error', code: 'invalid-widget-type', message: `unknown widget type "${widget.type}"`, entityIds: [`liveWidget:${widgetId}`] }];
  }
  return [...mappingFindings(read, widget.type, widget.mapping, widget.id), ...belowPageFinding(page, widget)];
}

// ── Queries ─────────────────────────────────────

/** `live.listPages`. */
export const liveListPages = defineCoreOperation({
  id: 'live.listPages',
  kind: 'query',
  description: [
    'List live control pages with their widgets (id, type, label, color, grid position/size, mapping).',
    GRID_DOC,
    'Mappings are returned in the input shape of live.addWidget plus a one-line mappingSummary.',
  ].join('\n'),
  input: z.object({ pageId: z.string().optional().describe('Only this page.') }),
  output: z.object({ pages: z.array(LivePageInfoSchema) }),
  examples: [{ input: {}, note: 'All pages.' }],
  run(ctx, input) {
    const pages = ctx.read.livePages()
      .filter(p => !input.pageId || p.id === input.pageId)
      .map(p => ({
        id: p.id,
        name: p.name,
        columns: p.columns,
        rows: pageRows(p),
        aspectRatio: `${p.aspectRatioW}:${p.aspectRatioH}`,
        backgroundColor: p.backgroundColor,
        widgets: p.widgets.map(w => ({
          id: w.id,
          type: w.type,
          ...(w.label !== undefined ? { label: w.label } : {}),
          ...(w.color !== undefined ? { color: w.color } : {}),
          gridX: w.gridX,
          gridY: w.gridY,
          gridW: w.gridW,
          gridH: w.gridH,
          mapping: fromLiveMapping(w.mapping),
          mappingSummary: mappingSummary(w.mapping),
        })),
      }));
    return { kind: 'query', value: { pages } };
  },
});

// ── Mutations ───────────────────────────────────

/** `live.addPage`. */
export const liveAddPage = defineCoreOperation({
  id: 'live.addPage',
  kind: 'mutation',
  description: [
    'Add an empty live control page; returns its id for live.addWidget.',
    'columns = page width in grid cells (default 60); aspect ratio default 16:9 (rows = floor(columns · h / w), 33 by default).',
  ].join('\n'),
  input: z.object({
    name: z.string().min(1).describe('Page name shown in the page selector.'),
    columns: z.number().int().min(4).max(240).optional().describe('Page width in grid cells (default 60).'),
    aspectRatioW: z.number().int().min(1).optional().describe('Aspect ratio width (default 16).'),
    aspectRatioH: z.number().int().min(1).optional().describe('Aspect ratio height (default 9).'),
    backgroundColor: HexColor.optional().describe('Background color (default #0a0a0a).'),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'use 1–64 letters, digits, "-" or "_"').optional()
      .describe('Choose the page id yourself (e.g. "ai-wave-page") so live.addWidget ops in the SAME apply batch can target it; the whole batch stays one undo step. Must not exist yet. Default: a generated id.'),
  }),
  output: z.object({ pageId: z.string() }),
  produces: ['live.addPage'],
  examples: [{ input: { name: 'Rainbow controls' }, note: 'Default 60-column 16:9 page.' }],
  run(ctx, input) {
    if (input.id !== undefined && findPage(ctx.read, input.id)) throw new Error(`live page id "${input.id}" already exists; choose another id or omit it`);
    const overrides: Partial<LivePage> = { name: input.name };
    if (input.id !== undefined) overrides.id = input.id;
    if (input.columns !== undefined) overrides.columns = input.columns;
    if (input.aspectRatioW !== undefined) overrides.aspectRatioW = input.aspectRatioW;
    if (input.aspectRatioH !== undefined) overrides.aspectRatioH = input.aspectRatioH;
    if (input.backgroundColor !== undefined) overrides.backgroundColor = input.backgroundColor;
    const page = defaultLivePage(overrides);
    return { kind: 'mutation', commands: [new AddLivePageCommand(page)], value: { pageId: page.id } };
  },
  verify(ctx, _input, value) {
    return findPage(ctx.read, value.pageId)
      ? []
      : [{ level: 'error', code: 'page-missing', message: `page "${value.pageId}" was not created`, entityIds: [`livePage:${value.pageId}`] }];
  },
});

/** `live.addWidget`. */
export const liveAddWidget = defineCoreOperation({
  id: 'live.addWidget',
  kind: 'mutation',
  description: [
    'Add a widget (button, slider, xy pad, color, label, beat, fixture preview) to a live page; returns its id.',
    GRID_DOC,
    'Omit gridX/gridY to auto-place at the first free spot (rows top→bottom, cells left→right, no overlap; below all widgets when the page is full). Omitted gridW/gridH use the default size.',
    MAPPING_DOC,
    'Errors (rolled back): unknown page, widget wider than the page, effect-param to a missing modifier/param, missing fixture/group/page target.',
  ].join('\n'),
  input: z.object({
    pageId: z.string().describe('Target page (live.listPages / live.addPage).'),
    type: LiveWidgetTypeSchema,
    label: z.string().optional().describe('Caption shown on the widget.'),
    gridX: GridCoord.optional().describe('Left cell (auto-placed when gridX or gridY is omitted).'),
    gridY: GridCoord.optional().describe('Top cell (auto-placed when gridX or gridY is omitted).'),
    gridW: GridSize.optional().describe('Width in cells (default per type).'),
    gridH: GridSize.optional().describe('Height in cells (default per type).'),
    color: HexColor.optional().describe('Widget color (#rrggbb), e.g. the button fill.'),
    mapping: LiveMappingInputSchema.optional().describe('What the widget controls (default none).'),
  }),
  output: z.object({ widgetId: z.string(), gridX: z.number(), gridY: z.number(), gridW: z.number(), gridH: z.number() }),
  produces: ['live.addWidget'],
  examples: [
    { input: { pageId: 'page-1', type: 'slider', label: 'Speed', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'speed' } }, note: 'Auto-placed slider driving the speed of modifier mod-1.' },
    { input: { pageId: 'page-1', type: 'slider', label: 'Count', gridX: 2, gridY: 0, mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'count' } }, note: 'Slider driving the plugin param "count".' },
    { input: { pageId: 'page-1', type: 'button', label: 'Strobe', color: '#ffffff', mapping: { type: 'global-function', function: 'strobe' } } },
    { input: { pageId: 'page-1', type: 'xy', label: 'Center', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'center' } }, note: 'XY pad driving the point param "center" (x/y 0–1).' },
    { input: { pageId: 'page-1', type: 'button', label: 'Invert', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'invert', behavior: 'hold' } }, note: 'Button setting the bool param "invert" while held.' },
  ],
  run(ctx, input) {
    const page = findPage(ctx.read, input.pageId);
    if (!page) throw new Error(pageNotFound(input.pageId));
    const [defW, defH] = CORE_WIDGET_SIZES[input.type];
    const w = input.gridW ?? defW;
    const h = input.gridH ?? defH;
    const spot = input.gridX !== undefined && input.gridY !== undefined
      ? { x: input.gridX, y: input.gridY }
      : findFreeSpot(page, w, h);
    assertFitsWidth(page, spot.x, w);
    const widget = defaultLiveWidget(input.type, spot.x, spot.y, [w, h]);
    if (input.label !== undefined) widget.label = input.label;
    if (input.color !== undefined) widget.color = input.color;
    if (input.mapping) widget.mapping = toLiveMapping(ctx.read, input.mapping);
    return {
      kind: 'mutation',
      commands: [new AddLiveWidgetCommand(page.id, widget)],
      value: { widgetId: widget.id, gridX: spot.x, gridY: spot.y, gridW: w, gridH: h },
    };
  },
  verify: (ctx, input, value) => widgetFindings(ctx.read, input.pageId, value.widgetId),
});

/** `live.updateWidget`. */
export const liveUpdateWidget = defineCoreOperation({
  id: 'live.updateWidget',
  kind: 'mutation',
  description: [
    'Update a widget\'s label, color, grid position/size and/or mapping; omitted fields stay unchanged, `null` clears label/color, `mapping` replaces the whole mapping.',
    GRID_DOC,
    MAPPING_DOC,
  ].join('\n'),
  input: z.object({
    pageId: z.string(),
    widgetId: z.string(),
    label: z.string().nullable().optional().describe('New caption; null removes it.'),
    color: HexColor.nullable().optional().describe('New color (#rrggbb); null removes it.'),
    gridX: GridCoord.optional(),
    gridY: GridCoord.optional(),
    gridW: GridSize.optional(),
    gridH: GridSize.optional(),
    mapping: LiveMappingInputSchema.optional().describe('Replacement mapping.'),
  }),
  output: z.object({ widgetId: z.string(), changed: z.array(z.string()).describe('Changed field groups: "grid", "label", "color", "mapping".') }),
  produces: ['live.moveWidget', 'live.updateMapping'],
  examples: [
    { input: { pageId: 'page-1', widgetId: 'w-1', mapping: { type: 'effect-param', modifierId: 'mod-1', paramKey: 'strength' } }, note: 'Rebind a slider to the strength.' },
    { input: { pageId: 'page-1', widgetId: 'w-1', gridX: 10, gridY: 4, label: 'Hue' } },
  ],
  run(ctx, input) {
    const { page, widget } = requireWidget(ctx.read, input.pageId, input.widgetId);
    const commands: Command[] = [];
    const changed: string[] = [];

    // Grid: merge with the current rectangle; one move/resize command.
    const next = {
      x: input.gridX ?? widget.gridX,
      y: input.gridY ?? widget.gridY,
      w: input.gridW ?? widget.gridW,
      h: input.gridH ?? widget.gridH,
    };
    if (next.x !== widget.gridX || next.y !== widget.gridY || next.w !== widget.gridW || next.h !== widget.gridH) {
      assertFitsWidth(page, next.x, next.w);
      commands.push(new MoveResizeLiveWidgetCommand(page.id, widget.id, next.x, next.y, next.w, next.h));
      changed.push('grid');
    }

    // Label / color / mapping: one mapping command with the given keys.
    const patch: Partial<Pick<LiveWidget, 'mapping' | 'label' | 'color'>> = {};
    if (input.label !== undefined) {
      patch.label = input.label ?? undefined;
      changed.push('label');
    }
    if (input.color !== undefined) {
      patch.color = input.color ?? undefined;
      changed.push('color');
    }
    if (input.mapping) {
      patch.mapping = toLiveMapping(ctx.read, input.mapping);
      changed.push('mapping');
    }
    if (Object.keys(patch).length) commands.push(new UpdateWidgetMappingCommand(page.id, widget.id, patch));

    if (!changed.length) throw new Error('nothing to update: pass label, color, gridX/gridY/gridW/gridH or mapping');
    return { kind: 'mutation', commands, value: { widgetId: widget.id, changed } };
  },
  verify: (ctx, input) => widgetFindings(ctx.read, input.pageId, input.widgetId),
});

/** `live.removeWidget`. */
export const liveRemoveWidget = defineCoreOperation({
  id: 'live.removeWidget',
  kind: 'mutation',
  description: [
    'Remove a widget from a live page (undo restores it at its previous position in the widget list).',
    'Section memberships referencing the widget are left as they are (same as deleting in the UI).',
  ].join('\n'),
  input: z.object({ pageId: z.string(), widgetId: z.string() }),
  output: z.object({ widgetId: z.string() }),
  produces: ['live.removeWidget'],
  examples: [{ input: { pageId: 'page-1', widgetId: 'w-1' } }],
  run(ctx, input) {
    const { page, widget } = requireWidget(ctx.read, input.pageId, input.widgetId);
    return { kind: 'mutation', commands: [new RemoveLiveWidgetCommand(page.id, widget.id, widget)], value: { widgetId: widget.id } };
  },
  verify(ctx, input) {
    const still = findPage(ctx.read, input.pageId)?.widgets.some(w => w.id === input.widgetId);
    return still
      ? [{ level: 'error', code: 'widget-not-removed', message: `widget "${input.widgetId}" is still on page "${input.pageId}"`, entityIds: [`liveWidget:${input.widgetId}`] }]
      : [];
  },
});

/** All live operations. */
export const liveOperations: CoreOperation[] = [liveListPages, liveAddPage, liveAddWidget, liveUpdateWidget, liveRemoveWidget];
