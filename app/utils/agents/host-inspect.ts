/**
 * `inspect` implementation of the app agent host (plan M3): project
 * digest, selection, event log, query operations and entity details.
 */
import type { InspectRequest, InspectResult, OperationCaller, OperationContext } from '@pixelmapper/agent-kit';
import type { EventLog, EventQuery } from '~/utils/observability/event-log';
import type { CoreReadApi } from '~/utils/operations/read-api';
import { liveWidgetView, livePageView } from '~/utils/operations/core/live';
import { modifierView } from '~/utils/operations/core/modifier-view';
import { normalizeInputAliases } from '~/utils/operations/input-aliases';
import type { OperationRegistry } from '~/utils/operations/registry';

// ── Dependencies ────────────────────────────────

/** What inspect reads from. */
export interface InspectDeps {
  registry: OperationRegistry;
  read: CoreReadApi;
  events: EventLog;
}

/** Default number of events returned by `selector: 'events'`. */
const DEFAULT_EVENT_LIMIT = 50;

// ── Queries ─────────────────────────────────────

/** Runs a query operation outside a transaction (validated input, no side effects). */
export async function runQuery(deps: InspectDeps, id: string, input: unknown): Promise<unknown> {
  const def = deps.registry.get(id);
  if (!def) {
    const similar = deps.registry.list({ search: id.split('.').pop() }).slice(0, 5).map(s => s.id);
    throw new Error(`Unknown operation "${id}".${similar.length ? ` Did you mean: ${similar.join(', ')}?` : ''}`);
  }
  if (def.kind !== 'query') throw new Error(`"${id}" is a ${def.kind}; run it with the apply tool.`);
  // Accept key aliases (`id` for `modifierId`) before validation.
  const aliased = normalizeInputAliases(def.input, input ?? {});
  if (!aliased.ok) throw new Error(`${id}: ${aliased.message}`);
  const parsed = def.input.safeParse(aliased.input);
  if (!parsed.success) {
    throw new Error(`${id}: ${parsed.error.issues.map(i => `${i.path.map(String).join('.') || '(input)'}: ${i.message}`).join('; ')}`);
  }
  // Composition inside queries: only further queries make sense here.
  const ops: OperationCaller = {
    query: async <T>(childId: string, childInput: unknown) => (await runQuery(deps, childId, childInput)) as T,
    call: async (childId, childInput) => ({ kind: 'query', value: await runQuery(deps, childId, childInput) }),
  };
  const ctx: OperationContext<CoreReadApi> = { read: deps.read, ops, actor: 'user', dryRun: false };
  const result = await def.run(ctx, parsed.data);
  return result.value;
}

// ── Entities ────────────────────────────────────

/**
 * Resolves one entity id (`fixture:12`, `modifier:abc`, `group:g1`,
 * `livePage:p1`, `liveWidget:w1`, or a plain fixture id). Live pages and
 * widgets use the agent vocabulary of `live.listPages` (mapping `modifierId`,
 * bare param keys), not the stored `effectId` / `params.<key>` form.
 */
function entityView(deps: InspectDeps, ref: string, full: boolean): unknown {
  const colon = ref.indexOf(':');
  const type = colon < 0 ? 'fixture' : ref.slice(0, colon);
  const id = colon < 0 ? ref : ref.slice(colon + 1);
  const read = deps.read;
  // Fixture ids may be numeric in older projects: try the string, then the number.
  const fixtureById = (getter: (i: string | number) => unknown) => getter(id) ?? (Number.isFinite(Number(id)) ? getter(Number(id)) : null);
  switch (type) {
    case 'fixture':
      return fixtureById(full ? i => read.fixtureDetail(i) : i => read.fixture(i));
    case 'modifier': {
      // The agent view (blend / spread / speed.value), like modifiers.list.
      const index = read.modifiers().findIndex(m => m.id === id);
      return index < 0 ? null : modifierView(read, read.modifiers()[index]!, index);
    }
    case 'group':
      return read.groups().find(g => String(g.id) === id) ?? null;
    case 'livePage': {
      const page = read.livePages().find(p => p.id === id);
      return page ? livePageView(page) : null;
    }
    case 'liveWidget': {
      for (const page of read.livePages()) {
        const widget = page.widgets.find(w => w.id === id);
        if (widget) return { ...liveWidgetView(widget), pageId: page.id };
      }
      return null;
    }
    default:
      return { error: `Unknown entity type "${type}" (use fixture, modifier, group, livePage or liveWidget).` };
  }
}

// ── Inspect ─────────────────────────────────────

/** Compact one-line header of the digest. */
function digestText(d: { bpm: number; fixtureCount: number; groups: unknown[]; modifiers: unknown[]; livePages: unknown[] }): string {
  return `project · ${d.fixtureCount} fixtures · ${d.groups.length} groups · ${d.modifiers.length} modifiers · ${d.livePages.length} live pages · ${d.bpm} BPM`;
}

/** Runs an inspect request. */
export async function inspect(deps: InspectDeps, request: InspectRequest): Promise<InspectResult> {
  const { selector } = request;
  const full = request.detail === 'full';
  if (selector === 'project') {
    const digest = await runQuery(deps, 'project.digest', {}) as Parameters<typeof digestText>[0];
    return { value: digest, text: digestText(digest) };
  }
  if (selector === 'selection') {
    const selection = deps.read.selection();
    return { value: selection };
  }
  if (selector === 'events') {
    const f = request.filter ?? {};
    const entries = deps.events.list({
      limit: request.limit ?? DEFAULT_EVENT_LIMIT,
      kind: f.kind,
      sinceId: f.sinceId,
      actor: f.actor as EventQuery['actor'],
    });
    const text = entries.map(e => `#${e.id} ${new Date(e.t).toISOString().slice(11, 19)} ${e.actor} ${e.kind} ${e.code}: ${e.message}`).join('\n');
    return { value: entries, text: text || 'No events yet.' };
  }
  if (Array.isArray(selector)) {
    const value = Object.fromEntries(selector.map(ref => [ref, entityView(deps, ref, full) ?? null]));
    return { value };
  }
  return { value: await runQuery(deps, selector.op, selector.input) };
}
