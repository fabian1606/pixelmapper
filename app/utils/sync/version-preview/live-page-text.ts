import type { LiveMapping, LiveWidget, SpeedConfig } from '~/utils/live/types';
import { normalizeWidgetType } from '~/utils/live/types';
import type { LivePageHighlight, RemovedEntity, RemovedWidget } from '~/utils/sync/version-preview/highlight-types';

/**
 * Text helpers of the live page miniature in the version-history hover
 * preview: widget kinds and display labels (mirroring the live widgets'
 * fallbacks without store access), page ordering, "Removed: …" lines and the
 * aria summary. Everything is defensive: snapshots can be old or partial.
 */

// ── Widget kinds ─────────────────────────────────────────────────────────────

/** Drawing kind of a widget (extension and unknown types → `extension`). */
export type LiveWidgetKind =
  | 'button' | 'slider' | 'xy' | 'color' | 'label' | 'beat'
  | 'fixture-preview' | 'controller-twin' | 'extension';

const CORE_KINDS = new Set<string>(['button', 'slider', 'xy', 'color', 'label', 'beat', 'fixture-preview', 'controller-twin']);

/** Default labels per kind (what the live widgets show without a label). */
const KIND_LABELS: Record<LiveWidgetKind, string> = {
  button: 'Button',
  slider: 'Slider',
  xy: 'XY',
  color: 'Color',
  label: 'Label',
  beat: 'BPM',
  'fixture-preview': 'Fixtures',
  'controller-twin': 'Controller',
  extension: 'Widget',
};

/** Global function names as shown on buttons (`LiveButtonWidget`). */
const GLOBAL_FN_LABELS: Record<string, string> = { strobe: 'Strobe', blind: 'Blind', blackout: 'Blackout', speed: 'Speed', 'stop-all': 'Stop all', 'step-back': 'Step back' };

/** Maps a (possibly legacy or malformed) widget type to its drawing kind. */
export function widgetKind(type: unknown): LiveWidgetKind {
  if (typeof type !== 'string') return 'extension';
  const t = normalizeWidgetType(type);
  return CORE_KINDS.has(t) ? t as LiveWidgetKind : 'extension';
}

/** Readable name of a widget type (`ext/my-knob` → "My knob"). */
export function typeDisplayName(type: unknown): string {
  const kind = widgetKind(type);
  if (kind !== 'extension' || typeof type !== 'string') return KIND_LABELS[kind];
  const name = type.split('/').pop()?.replace(/[-_]+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : KIND_LABELS.extension;
}

/** Speed button label (same wording as the live button). */
function speedLabel(cfg: Partial<SpeedConfig> | undefined): string {
  const m = cfg?.multiplier ?? 1;
  if (m === 0) return 'Freeze';
  if (m === 1) return 'Reset 1×';
  if (m === 0.5) return '½×';
  return `${m}×`;
}

/** Label derived from the mapping (no store access: presets show "Preset"). */
function mappingLabel(m: LiveMapping | undefined): string | null {
  if (!m || typeof m !== 'object') return null;
  if (m.type === 'global-function' && m.globalFunction === 'speed') return speedLabel(m.globalFunctionConfig as SpeedConfig);
  if (m.type === 'global-function' && typeof m.globalFunction === 'string') return GLOBAL_FN_LABELS[m.globalFunction] ?? m.globalFunction;
  if (m.type === 'preset') return 'Preset';
  if (m.type === 'page-switch') return 'Page';
  if (m.type === 'position-recall') return 'Position';
  return null;
}

/** Display label: own label → controller key → mapping fallback (buttons) → type name. */
export function widgetDisplayLabel(w: Partial<LiveWidget>): string {
  if (typeof w.label === 'string' && w.label.trim()) return w.label.trim();
  const kind = widgetKind(w.type);
  if (kind === 'controller-twin' && typeof w.controllerKey === 'string' && w.controllerKey) return w.controllerKey;
  if (kind === 'button') {
    // Buttons run a script of actions: label after the first one with a name.
    for (const a of Array.isArray(w.actions) ? w.actions : []) {
      const l = mappingLabel(a?.action);
      if (l) return l;
    }
    return KIND_LABELS.button;
  }
  return typeDisplayName(w.type);
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** Number of widget-level changes of a page (sections count as one). */
export function pageChangeCount(h: LivePageHighlight): number {
  const len = (a: unknown) => (Array.isArray(a) ? a.length : 0);
  return len(h.addedWidgets) + len(h.changedWidgets) + len(h.removedWidgets) + (h.sectionsChanged ? 1 : 0);
}

/**
 * Valid pages ordered for display. Rule: most widget changes first
 * (added + changed + removed widgets, +1 for changed sections; an added page
 * counts all its widgets); ties keep changed pages before added ones, then
 * the server order. Entries without a page object are dropped.
 */
export function pickLivePages(highlights: readonly LivePageHighlight[] | null | undefined): LivePageHighlight[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !!h && typeof h === 'object' && !!h.page && typeof h.page === 'object')
    .sort((a, b) => pageChangeCount(b.h) - pageChangeCount(a.h)
      || Number(a.h.status === 'added') - Number(b.h.status === 'added')
      || a.i - b.i)
    .map(({ h }) => h);
}

/** Page name or a fallback. */
export function pageName(h: LivePageHighlight): string {
  const n = h.page?.name;
  return typeof n === 'string' && n.trim() ? n.trim() : 'Untitled page';
}

// ── Text lines ───────────────────────────────────────────────────────────────

/** Joins names as "a, b, c +N more" (max ≥ 1 names shown). */
export function limitedList(names: readonly string[], max = 3): string {
  const n = Math.max(1, Math.floor(max));
  const shown = names.slice(0, n).join(', ');
  return names.length > n ? `${shown} +${names.length - n} more` : shown;
}

/** "Removed: Strobe, Slider, XY +2 more" ('' when nothing was removed). */
export function removedWidgetsText(list: readonly RemovedWidget[] | null | undefined, max = 3): string {
  if (!Array.isArray(list) || !list.length) return '';
  const names = list.map(r => widgetDisplayLabel({ label: r?.label, type: r?.type as LiveWidget['type'] }));
  return `Removed: ${limitedList(names, max)}`;
}

/** "Removed pages: Intro, Drops" ('' when none). */
export function removedPagesText(list: readonly RemovedEntity[] | null | undefined, max = 3): string {
  if (!Array.isArray(list) || !list.length) return '';
  const names = list.map(r => (typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : 'Untitled page'));
  return `Removed ${list.length === 1 ? 'page' : 'pages'}: ${limitedList(names, max)}`;
}

/** Plural helper ("1 widget", "2 widgets"). */
function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Aria summary, e.g. "Live page Main: 2 widgets added, 1 changed". */
export function livePageSummary(h: LivePageHighlight): string {
  const name = pageName(h);
  const len = (a: unknown) => (Array.isArray(a) ? a.length : 0);
  if (h.status === 'added') return `Live page ${name} added with ${count(len(h.page?.widgets), 'widget')}`;
  const parts: string[] = [];
  const added = len(h.addedWidgets);
  const changed = len(h.changedWidgets);
  const removed = len(h.removedWidgets);
  if (added) parts.push(`${count(added, 'widget')} added`);
  if (changed) parts.push(parts.length ? `${changed} changed` : `${count(changed, 'widget')} changed`);
  if (removed) parts.push(parts.length ? `${removed} removed` : `${count(removed, 'widget')} removed`);
  if (h.sectionsChanged) parts.push('sections changed');
  return `Live page ${name}: ${parts.length ? parts.join(', ') : 'changed'}`;
}
