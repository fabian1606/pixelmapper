/**
 * Operation definitions (ADR 0002 §4.1, amendment B12 for `action`).
 *
 * An operation is a typed, described unit of work that every caller (UI,
 * extensions, agents, MCP) uses. Three kinds:
 *
 * - `query`: reads state and returns a value. No side effects.
 * - `mutation`: returns **commands** (it MUST NOT mutate state in `run`);
 *   the transaction runner executes them as one undoable history group.
 * - `action`: performs a side effect **outside** the project history, e.g.
 *   building/registering a plugin package or publishing it. Actions must be
 *   idempotent (content-addressed) because they are neither undone nor
 *   rolled back. Transactions skip actions on `dryRun`.
 *
 * The types are host-agnostic: the read API (`R`) and the command type are
 * generic, so the same definitions work in the app and in headless hosts.
 */
import { z } from 'zod';
import type { Actor } from './actor';
import type { Finding } from './finding';

// ── Commands ────────────────────────────────────

/** Minimal undoable command shape (matches the app's `Command`). */
export interface CommandLike {
  description: string;
  execute(): void;
  undo(): void;
}

// ── Kinds & results ─────────────────────────────

/** Operation kind; see module docs. */
export type OperationKind = 'query' | 'mutation' | 'action';

/** Result of a query run. */
export interface QueryResult<O> { kind: 'query'; value: O }

/** Result of a mutation run: commands to execute plus the output value. */
export interface MutationResult<O, C extends CommandLike = CommandLike> { kind: 'mutation'; commands: C[]; value: O }

/** Result of an action run (side effect already performed). */
export interface ActionResult<O> { kind: 'action'; value: O; findings?: Finding[] }

/** Union of run results. */
export type OperationResult<O, C extends CommandLike = CommandLike> = QueryResult<O> | MutationResult<O, C> | ActionResult<O>;

// ── Context ─────────────────────────────────────

/** Calls other operations from inside an operation (composition). */
export interface OperationCaller {
  /** Runs a query operation and returns its (validated) value. */
  query<T = unknown>(id: string, input: unknown): Promise<T>;
  /** Runs any operation and returns its raw result (mutations: commands are NOT executed). */
  call(id: string, input: unknown): Promise<OperationResult<unknown>>;
}

/** Context handed to `run` / `verify`. */
export interface OperationContext<R = unknown> {
  /** Readonly view of the project; reflects earlier ops of the same batch. */
  read: R;
  /** Composition: call other operations. */
  ops: OperationCaller;
  /** Who runs the operation. */
  actor: Actor;
  /** True while the transaction runs as a dry run (state is restored afterwards). */
  dryRun: boolean;
}

// ── Definition ──────────────────────────────────

/** An example input shown by `describe`. */
export interface OperationExample<I> { input: I; note?: string }

/**
 * An operation. `id` is `namespace.name` for core operations and
 * `<extensionId>/<name>` for extension operations.
 */
export interface OperationDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType, R = unknown, C extends CommandLike = CommandLike> {
  id: string;
  kind: OperationKind;
  /**
   * Read by humans and AI. First line = one-line summary (used by listings).
   * MUST state units and coordinate spaces (normalized 0–1 world x/y like
   * plugin `Sample.x/y`, `z` = height normalized the same way).
   */
  description: string;
  input: I;
  output: O;
  examples?: OperationExample<z.input<I>>[];
  /** Command types a mutation produces (coverage test, ADR A1.6). */
  produces?: string[];
  /** Executes the operation. Mutations return commands and MUST NOT mutate state. */
  run(ctx: OperationContext<R>, input: z.output<I>): OperationResult<z.output<O>, C> | Promise<OperationResult<z.output<O>, C>>;
  /**
   * Checks postconditions after the commands executed (state is post-op).
   * `error` findings roll back the transaction.
   */
  verify?(ctx: OperationContext<R>, input: z.output<I>, value: z.output<O>): Finding[] | Promise<Finding[]>;
}

/** Erased definition type for registries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperationDefinition<R = any, C extends CommandLike = CommandLike> = OperationDefinition<z.ZodType, z.ZodType, R, C>;

/**
 * Identity helper that keeps the generic types of a definition
 * (`defineOperation({ id, input: z.object(...), run(ctx, input) { ... } })`).
 */
export function defineOperation<I extends z.ZodType, O extends z.ZodType, R = unknown, C extends CommandLike = CommandLike>(
  def: OperationDefinition<I, O, R, C>,
): OperationDefinition<I, O, R, C> {
  return def;
}

// ── Listing / describing ────────────────────────

/** Entry of an operation listing. */
export interface OperationSummary {
  id: string;
  kind: OperationKind;
  /** First line of the description. */
  summary: string;
  /** `core` or the extension id. */
  namespace: string;
}

/** Full description of an operation (the `describe` tool). */
export interface OperationDescription extends OperationSummary {
  description: string;
  /** JSON schema of the input (draft 2020-12, from Zod). */
  inputSchema: Record<string, unknown>;
  /** JSON schema of the output. */
  outputSchema: Record<string, unknown>;
  examples: OperationExample<unknown>[];
  produces?: string[];
}

/** Filter of an operation listing. */
export interface OperationQuery {
  /** Case-insensitive substring over id and description. */
  search?: string;
  /** Prefix of the id before the first `.` / `/` (`modifiers`, `my-ext`). */
  namespace?: string;
  kind?: OperationKind;
}

/** Zod schema of the listing filter. */
export const OperationQuerySchema = z.object({
  search: z.string().optional(),
  namespace: z.string().optional(),
  kind: z.enum(['query', 'mutation', 'action']).optional(),
});

/** Zod schema of a listing entry. */
export const OperationSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(['query', 'mutation', 'action']),
  summary: z.string(),
  namespace: z.string(),
});

/** Zod schema of a full description. */
export const OperationDescriptionSchema = OperationSummarySchema.extend({
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  examples: z.array(z.object({ input: z.unknown(), note: z.string().optional() })),
  produces: z.array(z.string()).optional(),
});
