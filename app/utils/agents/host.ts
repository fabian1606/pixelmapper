/**
 * App agent host (ADR 0002 §5, plan M3): implements `AgentHost` on the
 * operations registry, the transaction runner, the read API, the event log
 * and observe-lite. The agent tools (`@pixelmapper/agent-kit` `createTools`)
 * run against it; the MCP bridge client and the future in-app copilot share
 * the same host.
 */
import type { AgentHost, GuideProvider, ObserveReport, ObserveRequest } from '@pixelmapper/agent-kit';
import { eventLog as defaultEventLog, type EventLog } from '~/utils/observability/event-log';
import { applyOperations } from '~/utils/operations/apply';
import { readApi as defaultReadApi, type CoreReadApi } from '~/utils/operations/read-api';
import { operations as defaultRegistry, type OperationRegistry } from '~/utils/operations/registry';
import { createGuideProvider } from './guides';
import { inspect } from './host-inspect';

// ── Observe ─────────────────────────────────────

/** Observe implementation signature (from `~/utils/observability`). */
export type ObserveFn = (request: ObserveRequest, opts?: { signal?: AbortSignal }) => Promise<ObserveReport>;

/** Message when observe-lite is not part of this build yet. */
export const OBSERVE_UNAVAILABLE = 'observe is not available in this build of Pixelmapper (observability module missing). Use inspect and apply diffs/expectations instead.';

/**
 * Loads `observe` from `~/utils/observability` (built in parallel by WP-E).
 * Returns `null` when the module or the export does not exist, so the host
 * works before and after that module lands.
 */
export async function loadObserve(): Promise<ObserveFn | null> {
  try {
    // Glob instead of a plain dynamic import: a missing module yields an empty map instead of a build error.
    const modules = import.meta.glob<{ observe?: ObserveFn }>('../observability/index.ts');
    const load = Object.values(modules)[0];
    if (!load) return null;
    const mod = await load();
    return typeof mod.observe === 'function' ? mod.observe : null;
  }
  catch (err) {
    console.warn('[agents] loading observability failed:', err);
    return null;
  }
}

// ── Host ────────────────────────────────────────

/** Dependencies of the host (defaults: app singletons; tests inject their own). */
export interface AppAgentHostOptions {
  registry?: OperationRegistry;
  read?: CoreReadApi;
  events?: EventLog;
  guides?: GuideProvider;
  /** Observe implementation; default {@link loadObserve}. */
  observe?: () => Promise<ObserveFn | null>;
}

/** Creates the app agent host. */
export function createAppAgentHost(opts: AppAgentHostOptions = {}): AgentHost {
  const registry = opts.registry ?? defaultRegistry;
  const read = opts.read ?? defaultReadApi;
  const events = opts.events ?? defaultEventLog;
  const resolveObserve = opts.observe ?? loadObserve;
  let observeFn: Promise<ObserveFn | null> | null = null;

  return {
    listOperations: query => registry.list(query),
    describeOperation: id => registry.describe(id),
    inspect: request => inspect({ registry, read, events }, request),
    apply: (request, ctx) => applyOperations(request, { actor: ctx?.actor ?? 'user', registry, read }),
    async observe(request, ctx) {
      // Retry the lookup after a failed load (e.g. HMR added the module).
      observeFn ??= resolveObserve();
      const fn = await observeFn;
      if (!fn) {
        observeFn = null;
        throw new Error(OBSERVE_UNAVAILABLE);
      }
      return fn(request, { signal: ctx?.signal });
    },
    guides: opts.guides ?? createGuideProvider(),
  };
}
