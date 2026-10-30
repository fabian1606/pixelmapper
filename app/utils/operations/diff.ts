/**
 * Semantic diff of a transaction (ADR 0002 §4.3 `diff` / `affected`).
 *
 * Captures a plain snapshot of the entities agents care about (project,
 * fixtures, groups, modifiers, live pages and widgets) keyed by entity id
 * (`fixture:12`), and diffs two snapshots field by field. Modifiers use the
 * agent view (`blend`, `spread`, `speed.value`, …; `core/modifier-view.ts`),
 * live widgets the `live.addWidget` mapping vocabulary (buttons: their
 * `actions` script, e.g. `actions.0.trigger`, `actions.0.action.paramKey`).
 *
 * Whole added / removed entities are reported by a one-line summary (not the
 * full view) to keep apply results small; `affectedEntities` adds full views
 * only on request (`detail: "full"`).
 */
import type { EntityView, SemanticChange } from '@pixelmapper/agent-kit';
import { fromButtonAction } from './core/live-button-actions';
import { fromLiveMapping } from './core/live-mapping';
import { modifierSummary, modifierView } from './core/modifier-view';
import type { CoreReadApi } from './read-api';

// ── Snapshot ────────────────────────────────────

/** Entity id → plain view, plus a one-line summary per entity. */
export type StateSnapshot = Map<string, Record<string, unknown>> & { summaries: Map<string, string> };

/** Rounded coordinate for summaries. */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Captures the diffable state through the read API. */
export function captureState(read: CoreReadApi): StateSnapshot {
  const summaries = new Map<string, string>();
  const out = Object.assign(new Map<string, Record<string, unknown>>(), { summaries });
  out.set('project', { bpm: read.bpm(), extensionData: read.projectExtensionData() });
  summaries.set('project', `project · ${read.bpm()} BPM`);

  for (const f of read.fixtures()) {
    const detail = read.fixtureDetail(f.id);
    out.set(`fixture:${f.id}`, {
      name: f.name,
      position: { x: f.x, y: f.y, z: f.z },
      rotation: f.rotation,
      groupIds: f.groupIds,
      kindConfig: detail?.kind?.config,
      extensionData: detail?.extensionData,
      // Channel values and ranges by index (`channels.2.value`).
      channels: detail?.channels.map(c => ({ type: c.type, value: c.value, rangeMin: c.rangeMin, rangeMax: c.rangeMax })),
    });
    summaries.set(`fixture:${f.id}`, `${f.name} at (${r3(f.x)}, ${r3(f.y)})${f.rotation ? ` rotated ${r3(f.rotation)}°` : ''}`);
  }

  for (const g of read.groups()) {
    out.set(`group:${g.id}`, { name: g.name, parentId: g.parentId, fixtureIds: g.fixtureIds });
    summaries.set(`group:${g.id}`, `${g.name} · ${g.fixtureIds.length} fixtures`);
  }

  // Modifiers in the agent vocabulary (blend / spread / speed.value), like modifiers.list.
  read.modifiers().forEach((m, index) => {
    const { id: _id, ...view } = modifierView(read, m, index);
    out.set(`modifier:${m.id}`, view as Record<string, unknown>);
    summaries.set(`modifier:${m.id}`, modifierSummary(m, { id: m.id, ...view }));
  });

  for (const page of read.livePages()) {
    const { widgets, ...pageRest } = page;
    out.set(`livePage:${page.id}`, { ...pageRest, widgetIds: widgets.map(w => w.id) } as Record<string, unknown>);
    summaries.set(`livePage:${page.id}`, `live page "${page.name}" · ${widgets.length} widgets`);
    for (const w of widgets) {
      // Mapping / button actions in the agent vocabulary (`modifierId`, bare param key) like live.listPages.
      const mapping = fromLiveMapping(w.mapping) as Record<string, unknown> | undefined;
      const actions = w.actions?.map(fromButtonAction);
      out.set(`liveWidget:${w.id}`, { ...w, mapping, ...(actions ? { actions } : {}), pageId: page.id } as Record<string, unknown>);
      const label = (w as { label?: string }).label;
      // Summary target: the mapping, or a button's first effect-param action.
      const firstAction = actions?.map(a => a.action as Record<string, unknown>).find(a => 'modifierId' in a);
      const shown = w.type === 'button' ? firstAction : mapping;
      const target = shown && 'modifierId' in shown ? ` → ${String(shown.modifierId)}.${String(shown.paramKey)}` : '';
      summaries.set(`liveWidget:${w.id}`, `${w.type}${label ? ` "${label}"` : ''} on ${page.id}${target}`);
    }
  }
  return out;
}

// ── Diff ────────────────────────────────────────

/** Max nesting depth of field paths; deeper values are compared as a whole. */
const MAX_DEPTH = 4;

/** True for plain objects (not arrays / null). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** JSON equality (snapshots are JSON-like). */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Field-level differences between two values. Objects recurse by key;
 * arrays of objects recurse by index (channels); other arrays and values
 * past `MAX_DEPTH` are compared as a whole.
 */
function diffValue(entity: string, path: string, from: unknown, to: unknown, depth: number, out: SemanticChange[]): void {
  if (same(from, to)) return;
  const recurseArray = Array.isArray(from) && Array.isArray(to) && from.length === to.length && from.every(isPlainObject);
  if (depth < MAX_DEPTH && isPlainObject(from) && isPlainObject(to)) {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    for (const k of keys) diffValue(entity, path ? `${path}.${k}` : k, from[k], to[k], depth + 1, out);
    return;
  }
  if (depth < MAX_DEPTH && recurseArray) {
    (from as unknown[]).forEach((v, i) => diffValue(entity, `${path}.${i}`, v, (to as unknown[])[i], depth + 1, out));
    return;
  }
  out.push({ entity, field: path, from, to });
}

/**
 * Semantic changes from `before` to `after`: field-level changes, plus one
 * `added` (`to` = summary) / `removed` (`from` = summary) entry per whole
 * entity. Added / removed entities come first so they are never cut off.
 */
export function diffStates(before: StateSnapshot, after: StateSnapshot): SemanticChange[] {
  const whole: SemanticChange[] = [];
  const fields: SemanticChange[] = [];
  for (const [entity, view] of after) {
    const prev = before.get(entity);
    if (!prev) whole.push({ entity, field: 'added', to: after.summaries.get(entity) ?? entity });
    else diffValue(entity, '', prev, view, 0, fields);
  }
  for (const entity of before.keys()) {
    if (!after.has(entity)) whole.push({ entity, field: 'removed', from: before.summaries.get(entity) ?? entity });
  }
  return [...whole, ...fields];
}

/**
 * Every entity touched by `diff` with its one-line post-state summary;
 * `full` adds the complete post-state view (`null` when removed).
 */
export function affectedEntities(diff: readonly SemanticChange[], after: StateSnapshot, full = false): EntityView[] {
  const ids = [...new Set(diff.map(c => c.entity))];
  return ids.map(entity => ({
    entity,
    summary: after.has(entity) ? after.summaries.get(entity) ?? entity : 'removed',
    ...(full ? { view: after.get(entity) ?? null } : {}),
  }));
}

/** Compact project state used as the `state` of apply expectations. */
export function snapshotToJson(snapshot: StateSnapshot): Record<string, unknown> {
  return Object.fromEntries(snapshot);
}
