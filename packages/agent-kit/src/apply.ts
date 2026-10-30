/**
 * Transactions (ADR 0002 §4.3).
 *
 * `apply` runs a batch of operations as one undo group. Later ops see the
 * effect of earlier ones. Any `error` finding (invalid input, failed run,
 * failed `verify`) rolls the whole batch back. `dryRun` computes the same
 * result (diff, findings, expectations) and then restores the state.
 */
import { z } from 'zod';
import { ExpectationResultSchema, ExpectationSchema, type Expectation, type ExpectationResult } from './expectation';
import { FindingSchema, type Finding } from './finding';

// ── Request ─────────────────────────────────────

/** One op of a batch. */
export interface ApplyOp {
  /** Operation id, e.g. `modifiers.add`. */
  op: string;
  input: unknown;
}

/** Request of the `apply` tool. */
export interface ApplyRequest {
  ops: ApplyOp[];
  /** Undo-group label; history shows `AI: <label>` for agent actors. */
  label: string;
  /** Compute diff/findings/expectations, then restore the state. */
  dryRun?: boolean;
  /**
   * Evaluated after the batch (or on the dry-run state) against the subject
   * `{ state, diff, results }`: `state` is the project digest after the
   * batch, `diff` the semantic changes, `results` the per-op output values.
   */
  expect?: Expectation[];
}

/** Zod schema of an apply request. */
export const ApplyRequestSchema = z.object({
  ops: z.array(z.object({
    op: z.string().describe('Operation id, e.g. "fixtures.move". See the `operations` / `describe` tools.'),
    input: z.unknown().describe('The operation\'s input object: ALL of the operation\'s keys go here, e.g. { "moves": [ … ] } for fixtures.move (see `describe { "id": "<op>" }`).'),
  })).min(1).describe('Op entries { "op": "<id>", "input": { … } }, run in order.'),
  label: z.string().min(1).describe('Short undo label, e.g. "Add rainbow wave".'),
  dryRun: z.boolean().optional(),
  expect: z.array(ExpectationSchema).optional(),
});

// ── Result ──────────────────────────────────────

/** One field-level change (`{ entity: 'fixture:12', field: 'position.x', from: .2, to: .4 }`). */
export interface SemanticChange {
  /** `<type>:<id>`; types: `project`, `fixture`, `group`, `modifier`, `livePage`, `liveWidget`. */
  entity: string;
  /** `added` / `removed` for whole entities, else a dot path of the field. */
  field: string;
  from?: unknown;
  to?: unknown;
}

/** Post-state of a touched entity. */
export interface EntityView {
  entity: string;
  /** `null` when the entity was removed. */
  view: unknown;
}

/** Reference to an event-log entry written during the transaction. */
export interface EventRef {
  id: number;
  kind: string;
  code: string;
  message: string;
}

/** Output of one op of the batch. */
export interface OpOutcome {
  op: string;
  kind: 'query' | 'mutation' | 'action';
  /** Output value (absent when the op failed or an action was skipped). */
  value?: unknown;
  /** True when an action was skipped because of `dryRun`. */
  skipped?: boolean;
}

/** Result of the `apply` tool. */
export interface ApplyResult {
  /** True when the batch was committed to history (false on dry run or error). */
  committed: boolean;
  /** Id of the composite history entry (when committed). */
  undoGroupId?: string;
  diff: SemanticChange[];
  affected: EntityView[];
  findings: Finding[];
  /** Per-op outcomes in batch order (up to the failing op). */
  results: OpOutcome[];
  expectations?: ExpectationResult[];
  events: EventRef[];
}

/** Zod schema of a semantic change. */
export const SemanticChangeSchema = z.object({
  entity: z.string(),
  field: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

/** Zod schema of an apply result. */
export const ApplyResultSchema = z.object({
  committed: z.boolean(),
  undoGroupId: z.string().optional(),
  diff: z.array(SemanticChangeSchema),
  affected: z.array(z.object({ entity: z.string(), view: z.unknown() })),
  findings: z.array(FindingSchema),
  results: z.array(z.object({
    op: z.string(),
    kind: z.enum(['query', 'mutation', 'action']),
    value: z.unknown().optional(),
    skipped: z.boolean().optional(),
  })),
  expectations: z.array(ExpectationResultSchema).optional(),
  events: z.array(z.object({ id: z.number(), kind: z.string(), code: z.string(), message: z.string() })),
});
