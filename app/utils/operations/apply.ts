/**
 * Transaction runner (ADR 0002 D4, §4.3; plan A1.2).
 *
 * `applyOperations` runs a batch of operations as one undo group:
 *
 * 1. Each op's input is validated with its Zod schema.
 * 2. Queries return values; actions perform their side effect (skipped on
 *    `dryRun`, never rolled back — they must be idempotent).
 * 3. Mutation commands are executed **immediately**, so later ops (and
 *    `verify`) see the effect of earlier ones through `ctx.read`.
 * 4. Any `error` finding (unknown op, invalid input, run throws, `verify`
 *    error) undoes every executed command in reverse: state is untouched.
 * 5. On success the executed commands are recorded as one
 *    `CompositeCommand` (`AI: <label>` for agent actors) via
 *    `history.execute(cmd, { applied: true })` — one undo step.
 * 6. `dryRun` computes diff/findings/expectations, then undoes everything.
 */
import {
  APPLY_ENVELOPE,
  ApplyRequestSchema,
  actorKind,
  evaluateExpectations,
  normalizeApplyRequest,
  summarizeInputSchema,
  toJsonSchema,
  type Actor,
  type ApplyRequest,
  type ApplyResult,
  type EventRef,
  type Finding,
  type OpOutcome,
  type OperationCaller,
  type OperationContext,
  type OperationResult,
} from '@pixelmapper/agent-kit';
import type { z } from 'zod';
import { CompositeCommand } from '~/components/engine/commands/composite-command';
import { useHistory, type Command } from '~/components/engine/composables/use-history';
import { eventLog, logEvent } from '~/utils/observability/event-log';
import { modifierViews } from './core/modifier-view';
import { affectedEntities, captureState, diffStates } from './diff';
import { normalizeInputAliases } from './input-aliases';
import { readApi as defaultReadApi, type CoreReadApi } from './read-api';
import { operations as defaultRegistry, type OperationRegistry } from './registry';

// ── Options ─────────────────────────────────────

/** Dependencies of a transaction (defaults: app singletons). */
export interface ApplyOptions {
  actor?: Actor;
  registry?: OperationRegistry;
  read?: CoreReadApi;
  /** Records the composite; default `useHistory().execute`. */
  record?: (cmd: Command, opts: { actor: Actor; applied: true }) => void;
}

/** Error carrying findings; aborts the batch. */
class AbortBatch extends Error {
  constructor(readonly findings: Finding[]) {
    super(findings.map(f => f.message).join('; '));
  }
}

// ── Helpers ─────────────────────────────────────

/** Readable message of an unknown thrown value. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Zod issues as one line (`input.targets: Required; …`). */
function issuesText(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map(i => `${i.path.length ? i.path.map(String).join('.') : '(input)'}: ${i.message}`).join('; ');
}

/**
 * Invalid-input message with the expected shape: the Zod issues, the
 * operation's input summary (required keys) and the envelope hint.
 */
export function invalidInputMessage(id: string, schema: z.ZodType, input: unknown, issues: string): string {
  const expected = summarizeInputSchema(toJsonSchema(schema, 'input'));
  const head = input === undefined
    ? `${id}: the op entry has no \`input\`. Op entries are { "op": "${id}", "input": { … } }`
    : `${id}: ${issues}`;
  return `${head}. Expected input (? = optional): ${expected}. Entry shape: { "op": "${id}", "input": ${expected} }; see describe { "id": "${id}" }.`;
}

/** Undo label: agent changes are prefixed with `AI:`. */
export function undoLabel(label: string, actor: Actor): string {
  return actorKind(actor) === 'agent' && !label.startsWith('AI:') ? `AI: ${label}` : label;
}

/** Compact JSON state used as `state` subject of apply expectations. */
export function expectationState(read: CoreReadApi): Record<string, unknown> {
  return {
    bpm: read.bpm(),
    fixtures: read.fixtures(),
    groups: read.groups(),
    modifiers: modifierViews(read),
    livePages: read.livePages(),
    selection: read.selection(),
  };
}

/**
 * Tolerates the outcome shape the apply output shows (`results: [{ op, kind,
 * value }]`): `results.N.value.x` → `results.N.x` when op N's value has no own
 * `value` key (the expectation subject holds the values directly).
 */
export function resultValuePath(path: string, values: readonly unknown[]): string {
  const m = /^results\.(\d+)\.value(\.|$)/.exec(path);
  if (!m) return path;
  const v = values[Number(m[1])];
  if (v && typeof v === 'object' && 'value' in v) return path;
  return `results.${m[1]}${path.slice(m[0].length - m[2]!.length)}`;
}

// ── Runner ──────────────────────────────────────

/** Runs a batch of operations as one transaction; see module docs. */
export async function applyOperations(request: ApplyRequest, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const actor = opts.actor ?? 'user';
  const registry = opts.registry ?? defaultRegistry;
  const read = opts.read ?? defaultReadApi;
  const firstEventId = eventLog.lastId();
  const findings: Finding[] = [];
  const results: OpOutcome[] = [];
  const executed: Command[] = [];

  /** Events written since the transaction started. */
  const events = (): EventRef[] => eventLog.list({ sinceId: firstEventId })
    .map(e => ({ id: e.id, kind: e.kind, code: e.code, message: e.message }));

  // Lenient envelope (`{ op, moves }` → `{ op, input: { moves } }`); notes become info findings.
  const normalized = normalizeApplyRequest(request);
  findings.push(...normalized.findings);
  if (normalized.findings.some(f => f.level === 'error')) {
    return { committed: false, diff: [], affected: [], results, events: [], findings };
  }
  const parsed = ApplyRequestSchema.safeParse(normalized.request);
  if (!parsed.success) {
    return {
      committed: false, diff: [], affected: [], results, events: [],
      findings: [...findings, { level: 'error', code: 'invalid-request', message: `${issuesText(parsed.error.issues)}. Expected ${APPLY_ENVELOPE}.` }],
    };
  }
  const { ops, label, dryRun = false, expect, detail } = parsed.data;

  /** Runs an op without executing its commands (also used for composition). */
  async function runOp(id: string, input: unknown, opIndex: number): Promise<{ result: OperationResult<unknown, Command>; input: unknown }> {
    const def = registry.get(id);
    if (!def) {
      const hint = registry.list({ search: id.split('.').pop() }).slice(0, 5).map(s => s.id).join(', ');
      throw new AbortBatch([{ level: 'error', code: 'unknown-operation', message: `Unknown operation "${id}".${hint ? ` Did you mean: ${hint}?` : ''}`, opIndex }]);
    }
    // Accept key aliases (`id` for `modifierId`) before validation.
    const valid = def.input.safeParse(normalizeInputAliases(def.input, input));
    if (!valid.success) {
      throw new AbortBatch([{ level: 'error', code: 'invalid-input', message: invalidInputMessage(id, def.input, input, issuesText(valid.error.issues)), opIndex }]);
    }
    try {
      const result = await def.run(ctx, valid.data);
      return { result: result as OperationResult<unknown, Command>, input: valid.data };
    }
    catch (err) {
      if (err instanceof AbortBatch) throw err;
      throw new AbortBatch([{ level: 'error', code: 'operation-failed', message: `${id}: ${messageOf(err)}`, opIndex }]);
    }
  }

  // Composition: queries run directly; `call` returns raw results (no execution).
  const caller: OperationCaller = {
    async query<T>(id: string, input: unknown): Promise<T> {
      const { result } = await runOp(id, input, -1);
      if (result.kind !== 'query') throw new Error(`ops.query("${id}") is a ${result.kind}`);
      return result.value as T;
    },
    async call(id, input) {
      return (await runOp(id, input, -1)).result;
    },
  };
  const ctx: OperationContext<CoreReadApi> = { read, ops: caller, actor, dryRun };

  /** Undoes every executed command in reverse order. */
  function rollback() {
    for (let i = executed.length - 1; i >= 0; i--) {
      try { executed[i]!.undo(); }
      catch (err) { console.error('[operations] rollback failed:', err); }
    }
    executed.length = 0;
  }

  const before = captureState(read);
  let failed = false;
  /** Ops with end-of-batch postconditions (`verifyAfterBatch`), in batch order. */
  const deferred: { index: number; op: string; input: unknown; value: unknown }[] = [];

  for (let i = 0; i < ops.length; i++) {
    const { op, input } = ops[i]!;
    try {
      const def = registry.get(op);
      if (def?.kind === 'action' && dryRun) {
        results.push({ op, kind: 'action', skipped: true });
        findings.push({ level: 'info', code: 'action-skipped', message: `${op} is an action (side effect outside history) and was skipped in the dry run.`, opIndex: i });
        continue;
      }
      const { result, input: parsedInput } = await runOp(op, input, i);
      if (result.kind === 'mutation') {
        for (const cmd of result.commands) {
          try { cmd.execute(); }
          catch (err) { throw new AbortBatch([{ level: 'error', code: 'command-failed', message: `${op}: ${cmd.description}: ${messageOf(err)}`, opIndex: i }]); }
          executed.push(cmd);
        }
      }
      if (result.kind === 'action' && result.findings) findings.push(...result.findings.map(f => ({ ...f, opIndex: i })));
      // Postconditions run against the post-op state.
      if (def?.verify) {
        const verified = (await def.verify(ctx, parsedInput, result.value)).map(f => ({ ...f, opIndex: i }));
        findings.push(...verified);
        if (verified.some(f => f.level === 'error')) throw new AbortBatch([]);
      }
      if (def?.verifyAfterBatch) deferred.push({ index: i, op, input: parsedInput, value: result.value });
      results.push({ op, kind: result.kind, value: result.value });
      logEvent({ actor, kind: 'operation', code: op, message: `${op} (${label})${dryRun ? ' [dry run]' : ''}` });
    }
    catch (err) {
      const extra = err instanceof AbortBatch ? err.findings : [{ level: 'error' as const, code: 'operation-failed', message: `${op}: ${messageOf(err)}`, opIndex: i }];
      findings.push(...extra);
      failed = true;
      break;
    }
  }

  // End-of-batch postconditions: later ops may have fixed what an earlier op left.
  if (!failed) {
    for (const d of deferred) {
      const def = registry.get(d.op);
      try {
        const verified = (await def!.verifyAfterBatch!(ctx, d.input, d.value)).map(f => ({ ...f, opIndex: d.index }));
        findings.push(...verified);
        if (verified.some(f => f.level === 'error')) failed = true;
      }
      catch (err) {
        findings.push({ level: 'error', code: 'operation-failed', message: `${d.op}: ${messageOf(err)}`, opIndex: d.index });
        failed = true;
      }
    }
  }

  if (failed) {
    rollback();
    logEvent({ actor, kind: 'operation.rollback', code: 'apply', message: `Rolled back "${label}"` });
    return { committed: false, diff: [], affected: [], findings, results, events: events() };
  }

  const after = captureState(read);
  const diff = diffStates(before, after);
  const affected = affectedEntities(diff, after, detail === 'full');
  const values = results.map(r => r.value);
  const expectations = expect?.length
    ? evaluateExpectations({ state: expectationState(read), diff, results: values }, expect.map(e => ({ ...e, path: resultValuePath(e.path, values) })))
    : undefined;

  if (dryRun || executed.length === 0) {
    rollback();
    return { committed: false, diff, affected, findings, results, events: events(), ...(expectations ? { expectations } : {}) };
  }

  // Commit: the children already ran; record them as one undo step.
  const group = new CompositeCommand(executed, undoLabel(label, actor), actor);
  const record = opts.record ?? ((cmd, o) => useHistory().execute(cmd, o));
  record(group, { actor, applied: true });
  return {
    committed: true,
    undoGroupId: group.id,
    diff, affected, findings, results,
    events: events(),
    ...(expectations ? { expectations } : {}),
  };
}
