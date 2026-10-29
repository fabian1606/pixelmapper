/**
 * Operations registry (ADR 0002 D1, §4.1; plan A1.2).
 *
 * Holds every operation (core and extension contributed). Ids are
 * `namespace.name` for core operations and `<extensionId>/<name>` for
 * extensions; ids are unique. The registry lists, searches and describes
 * operations (JSON schemas from Zod) for agent tools.
 */
import {
  toJsonSchema,
  type AnyOperationDefinition,
  type OperationDescription,
  type OperationQuery,
  type OperationSummary,
} from '@pixelmapper/agent-kit';
import type { Command } from '~/components/engine/composables/use-history';
import type { CoreReadApi } from './read-api';

// ── Types ───────────────────────────────────────

/** Operation definition as used by the app host (read API + app commands). */
export type CoreOperation = AnyOperationDefinition<CoreReadApi, Command>;

/** Registration options. */
export interface RegisterOptions {
  /** Owning extension; the id MUST then be `<extensionId>/<name>`. */
  extensionId?: string;
  /** Replace an existing operation with the same id (hot reload). */
  replace?: boolean;
}

/** An operations registry. */
export interface OperationRegistry {
  /** Registers an operation; returns an unregister function. Throws on invalid / duplicate ids. */
  register(def: CoreOperation, opts?: RegisterOptions): () => void;
  unregister(id: string): boolean;
  get(id: string): CoreOperation | undefined;
  has(id: string): boolean;
  /** Summaries sorted by id, filtered by `query`. */
  list(query?: OperationQuery): OperationSummary[];
  /** Full description with JSON schemas and examples; `null` when unknown. */
  describe(id: string): OperationDescription | null;
  /** All definitions (registration order). */
  all(): CoreOperation[];
}

// ── Id rules ────────────────────────────────────

/** Core ids: `namespace.name` (camelCase segments, at least two). */
const CORE_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
/** Extension ids: `<extensionId>/<name>` (name may contain dots). */
const EXTENSION_ID = /^([a-z0-9][a-z0-9-]*)\/([a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*)$/;

/** Namespace of an id: extension id, or the first segment of a core id. */
export function operationNamespace(id: string): string {
  const slash = id.indexOf('/');
  if (slash >= 0) return id.slice(0, slash);
  return id.split('.')[0]!;
}

/** First non-empty line of a description. */
function summaryOf(description: string): string {
  return description.split('\n').map(l => l.trim()).find(Boolean) ?? '';
}

/** Validates an id against the core / extension rules; throws a readable error. */
function validateId(id: string, extensionId?: string): void {
  if (extensionId) {
    const m = EXTENSION_ID.exec(id);
    if (!m || m[1] !== extensionId) {
      throw new Error(`[operations] extension operation id "${id}" must be "${extensionId}/<name>"`);
    }
    return;
  }
  if (!CORE_ID.test(id)) {
    throw new Error(`[operations] core operation id "${id}" must be "namespace.name" (camelCase segments)`);
  }
}

// ── Implementation ──────────────────────────────

/** Creates an empty registry (tests; the app uses the `operations` singleton). */
export function createOperationRegistry(): OperationRegistry {
  const defs = new Map<string, CoreOperation>();
  // JSON schemas are generated lazily once per definition.
  const descriptions = new WeakMap<CoreOperation, OperationDescription>();

  /** Summary of a definition. */
  const summarize = (def: CoreOperation): OperationSummary => ({
    id: def.id,
    kind: def.kind,
    summary: summaryOf(def.description),
    namespace: operationNamespace(def.id),
  });

  const registry: OperationRegistry = {
    register(def, opts = {}) {
      validateId(def.id, opts.extensionId);
      if (!def.description?.trim()) throw new Error(`[operations] "${def.id}" needs a description`);
      if (defs.has(def.id) && !opts.replace) throw new Error(`[operations] duplicate operation id "${def.id}"`);
      defs.set(def.id, def);
      return () => {
        if (defs.get(def.id) === def) defs.delete(def.id);
      };
    },

    unregister: id => defs.delete(id),
    get: id => defs.get(id),
    has: id => defs.has(id),
    all: () => [...defs.values()],

    list(query = {}) {
      const needle = query.search?.toLowerCase();
      return [...defs.values()]
        .filter(d => !query.namespace || operationNamespace(d.id) === query.namespace)
        .filter(d => !query.kind || d.kind === query.kind)
        .filter(d => !needle || d.id.toLowerCase().includes(needle) || d.description.toLowerCase().includes(needle))
        .map(summarize)
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    describe(id) {
      const def = defs.get(id);
      if (!def) return null;
      const cached = descriptions.get(def);
      if (cached) return cached;
      const description: OperationDescription = {
        ...summarize(def),
        description: def.description,
        inputSchema: toJsonSchema(def.input, 'input'),
        outputSchema: toJsonSchema(def.output, 'output'),
        examples: (def.examples ?? []).map(e => ({ ...e })),
        ...(def.produces ? { produces: [...def.produces] } : {}),
      };
      descriptions.set(def, description);
      return description;
    },
  };
  return registry;
}

/** The app-wide registry. */
export const operations: OperationRegistry = createOperationRegistry();
