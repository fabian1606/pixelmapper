/**
 * Semantic diff of a transaction (ADR 0002 §4.3 `diff` / `affected`).
 *
 * Captures a plain snapshot of the entities agents care about (project,
 * fixtures, groups, modifiers, live pages and widgets) keyed by entity id
 * (`fixture:12`), and diffs two snapshots field by field.
 */
import type { EntityView, SemanticChange } from '@pixelmapper/agent-kit';
import type { CoreReadApi } from './read-api';

// ── Snapshot ────────────────────────────────────

/** Entity id → plain view. */
export type StateSnapshot = Map<string, Record<string, unknown>>;

/** Captures the diffable state through the read API. */
export function captureState(read: CoreReadApi): StateSnapshot {
  const out: StateSnapshot = new Map();
  out.set('project', { bpm: read.bpm(), extensionData: read.projectExtensionData() });

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
  }

  for (const g of read.groups()) {
    out.set(`group:${g.id}`, { name: g.name, parentId: g.parentId, fixtureIds: g.fixtureIds });
  }

  read.modifiers().forEach((m, index) => {
    const { id: _id, ...rest } = m;
    out.set(`modifier:${m.id}`, { ...rest, index } as Record<string, unknown>);
  });

  for (const page of read.livePages()) {
    const { widgets, ...pageRest } = page;
    out.set(`livePage:${page.id}`, { ...pageRest, widgetIds: widgets.map(w => w.id) } as Record<string, unknown>);
    for (const w of widgets) {
      out.set(`liveWidget:${w.id}`, { ...w, pageId: page.id } as Record<string, unknown>);
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

/** Semantic changes from `before` to `after`. */
export function diffStates(before: StateSnapshot, after: StateSnapshot): SemanticChange[] {
  const out: SemanticChange[] = [];
  for (const [entity, view] of after) {
    const prev = before.get(entity);
    if (!prev) out.push({ entity, field: 'added', to: view });
    else diffValue(entity, '', prev, view, 0, out);
  }
  for (const [entity, view] of before) {
    if (!after.has(entity)) out.push({ entity, field: 'removed', from: view });
  }
  return out;
}

/** Post-state views of every entity touched by `diff`. */
export function affectedEntities(diff: readonly SemanticChange[], after: StateSnapshot): EntityView[] {
  const ids = [...new Set(diff.map(c => c.entity))];
  return ids.map(entity => ({ entity, view: after.get(entity) ?? null }));
}

/** Compact project state used as the `state` of apply expectations. */
export function snapshotToJson(snapshot: StateSnapshot): Record<string, unknown> {
  return Object.fromEntries(snapshot);
}
