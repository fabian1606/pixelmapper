import type { LivePage, LiveWidget } from '~/utils/live/types';
import { CORE_WIDGET_SIZES, getPageResolution } from '~/utils/live/types';
import type { LivePageHighlight } from '~/utils/sync/version-preview/highlight-types';
import { widgetDisplayLabel, widgetKind, type LiveWidgetKind } from '~/utils/sync/version-preview/live-page-text';

/**
 * Pure geometry of the live page miniature in the version-history hover
 * preview: fits the page resolution (`getPageResolution`) into a viewport and
 * maps every widget to a rect in viewport px with its diff status, drawing
 * kind, label and color. Defensive against malformed / old snapshot JSON
 * (invalid page settings fall back to the defaults, widgets are clamped into
 * the page, invalid sizes get the type's default footprint).
 */

export { pickLivePages, removedWidgetsText, removedPagesText, livePageSummary } from '~/utils/sync/version-preview/live-page-text';
export type { LiveWidgetKind } from '~/utils/sync/version-preview/live-page-text';

// ── Types ────────────────────────────────────────────────────────────────────

/** Diff status of a widget in the shown version. */
export type WidgetStatus = 'added' | 'changed' | 'same';

/** One widget in viewport px (relative to the page rect). */
export interface PreviewWidgetRect {
  id: string;
  kind: LiveWidgetKind;
  status: WidgetStatus;
  label: string;
  /** Validated widget color (null = the kind's default). */
  color: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fitted page: scale/offset into the viewport plus the widget rects. */
export interface LivePageLayout {
  /** Page px → viewport px. */
  scale: number;
  /** Page rect in the viewport. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  background: string;
  /** Label font size in viewport px (14 px page text scaled, clamped). */
  fontPx: number;
  /** Changed / added widgets come last (drawn on top). */
  widgets: PreviewWidgetRect[];
  /** Widgets beyond `MAX_WIDGETS` (not drawn). */
  hidden: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Upper bound of drawn widgets (keeps hover rendering cheap). */
export const MAX_WIDGETS = 400;
const DEFAULT_PAGE = { columns: 60, gridSize: 32, aspectRatioW: 16, aspectRatioH: 9, backgroundColor: '#0a0a0a' };
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\))$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Finite number within (0, max], else the fallback. */
function positive(v: unknown, fallback: number, max = 10_000): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback;
}

/** Finite number, else the fallback. */
function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Accepts hex / rgb() / hsl() colors only (null otherwise). */
export function safeColor(v: unknown): string | null {
  return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : null;
}

/** Page settings with invalid values replaced by the defaults. */
export function sanitizePage(page: Partial<LivePage>): Pick<LivePage, 'columns' | 'gridSize' | 'aspectRatioW' | 'aspectRatioH'> {
  return {
    columns: positive(page.columns, DEFAULT_PAGE.columns, 1000),
    gridSize: positive(page.gridSize, DEFAULT_PAGE.gridSize, 1000),
    aspectRatioW: positive(page.aspectRatioW, DEFAULT_PAGE.aspectRatioW),
    aspectRatioH: positive(page.aspectRatioH, DEFAULT_PAGE.aspectRatioH),
  };
}

/** Status of a widget id given the highlight id lists (added wins). */
function statusOf(id: string, added: Set<string>, changed: Set<string>): WidgetStatus {
  if (added.has(id)) return 'added';
  return changed.has(id) ? 'changed' : 'same';
}

/** Clamps a 1D span [start, start+size) into [0, total) keeping ≥ 1 unit. */
function clampSpan(start: number, size: number, total: number): [number, number] {
  const s = Math.min(Math.max(0, start), Math.max(0, total - 1));
  return [s, Math.max(1, Math.min(size, total - s))];
}

/** Widget rect in page px (grid units × gridSize), clamped into the page. */
function widgetRect(w: Partial<LiveWidget>, cols: number, rows: number): [number, number, number, number] {
  const [dw, dh] = CORE_WIDGET_SIZES[w.type as keyof typeof CORE_WIDGET_SIZES] ?? [4, 4];
  const [x, gw] = clampSpan(finite(w.gridX, 0), positive(w.gridW, dw), cols);
  const [y, gh] = clampSpan(finite(w.gridY, 0), positive(w.gridH, dh), rows);
  return [x, y, gw, gh];
}

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * Fits `page` into a `width` × `height` viewport (centered, `padding` px
 * margin) and maps its widgets. Returns null when `page` is not an object.
 */
export function layoutLivePage(
  page: LivePage | null | undefined,
  width: number,
  height: number,
  highlight?: Partial<Pick<LivePageHighlight, 'addedWidgets' | 'changedWidgets'>>,
  padding = 0,
): LivePageLayout | null {
  if (!page || typeof page !== 'object') return null;
  const settings = sanitizePage(page);
  const res = getPageResolution({ ...page, ...settings });
  const pageW = Math.max(1, res.w);
  const pageH = Math.max(1, res.h);
  const availW = Math.max(1, finite(width, 320) - 2 * padding);
  const availH = Math.max(1, finite(height, 200) - 2 * padding);
  const scale = Math.min(availW / pageW, availH / pageH);
  const cols = settings.columns;
  // Rows in grid units (fractional bottom row allowed, as in the live view).
  const rows = Math.max(1, pageH / settings.gridSize);
  const unit = settings.gridSize * scale;

  const ids = (a: unknown) => new Set(Array.isArray(a) ? a.filter((v): v is string => typeof v === 'string') : []);
  const added = ids(highlight?.addedWidgets);
  const changed = ids(highlight?.changedWidgets);
  const raw = Array.isArray(page.widgets) ? page.widgets.filter(w => !!w && typeof w === 'object') : [];

  const widgets: PreviewWidgetRect[] = raw.slice(0, MAX_WIDGETS).map((w, i) => {
    const id = typeof w.id === 'string' ? w.id : `#${i}`;
    const [x, y, gw, gh] = widgetRect(w, cols, rows);
    return {
      id,
      kind: widgetKind(w.type),
      status: statusOf(id, added, changed),
      label: widgetDisplayLabel(w),
      color: safeColor(w.color),
      x: x * unit,
      y: y * unit,
      width: gw * unit,
      height: gh * unit,
    };
  });
  // Highlighted widgets last so their outline is not covered (stable otherwise).
  const rank = (s: WidgetStatus) => (s === 'same' ? 0 : 1);
  widgets.sort((a, b) => rank(a.status) - rank(b.status));

  return {
    scale,
    offsetX: (finite(width, 320) - pageW * scale) / 2,
    offsetY: (finite(height, 200) - pageH * scale) / 2,
    width: pageW * scale,
    height: pageH * scale,
    background: safeColor(page.backgroundColor) ?? DEFAULT_PAGE.backgroundColor,
    fontPx: Math.min(10, Math.max(5, 14 * scale)),
    widgets,
    hidden: Math.max(0, raw.length - MAX_WIDGETS),
  };
}
