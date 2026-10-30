/**
 * `apply` tool: run a batch of operations as one undoable transaction.
 */
import { ApplyRequestSchema, type ApplyResult } from '../apply';
import type { ExpectationResult } from '../expectation';
import type { Finding } from '../finding';
import { errorOutput, messageOf, parseInput, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Max diff lines in the text summary (the JSON part has all of them). */
const MAX_DIFF_LINES = 40;

/** Compact value for a diff line. */
function short(value: unknown): string {
  const s = JSON.stringify(value);
  if (s === undefined) return '∅';
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** One line per finding. */
function findingLines(findings: readonly Finding[]): string[] {
  return findings.map(f => `${f.level.toUpperCase()} ${f.code}${f.opIndex !== undefined ? ` (op ${f.opIndex})` : ''}: ${f.message}`);
}

/** One line per expectation. */
function expectationLines(results: readonly ExpectationResult[]): string[] {
  return results.map(r => r.message);
}

/** Text summary of an apply result. */
export function summarizeApply(result: ApplyResult, dryRun: boolean, label: string): string {
  // Actions (e.g. plugins.build) run outside history, so a batch of only
  // actions commits nothing even when every action succeeded.
  const actionsRan = result.results.some(r => r.kind === 'action' && !r.skipped);
  const head = result.committed
    ? `Committed "${label}" as one undo step (${result.undoGroupId ?? 'no id'}).`
    : dryRun ? `Dry run of "${label}": nothing was changed.`
      : actionsRan && result.diff.length === 0 && !result.findings.some(f => f.level === 'error')
        ? `Ran "${label}": action results below (actions are not part of undo history).`
        : `Not committed: "${label}" was rolled back or changed nothing.`;
  const lines = [head, `${result.diff.length} change(s):`];
  for (const c of result.diff.slice(0, MAX_DIFF_LINES)) {
    lines.push(c.field === 'added' || c.field === 'removed'
      ? `  ${c.entity} ${c.field}`
      : `  ${c.entity} ${c.field}: ${short(c.from)} → ${short(c.to)}`);
  }
  if (result.diff.length > MAX_DIFF_LINES) lines.push(`  … ${result.diff.length - MAX_DIFF_LINES} more (see JSON)`);
  if (result.findings.length) lines.push('Findings:', ...findingLines(result.findings).map(l => `  ${l}`));
  if (result.expectations?.length) lines.push('Expectations:', ...expectationLines(result.expectations).map(l => `  ${l}`));
  return lines.join('\n');
}

/** Creates the `apply` tool. */
export function createApplyTool(): ToolDefinition {
  return {
    name: 'apply',
    description: [
      'Change the project: run a batch of operations (`ops: [{ op, input }]`) as ONE transaction and one undo step labelled "AI: <label>" in the app.',
      'Later ops see the effects of earlier ones. Any error (unknown op, invalid input, failed verification) rolls the whole batch back.',
      'Use `dryRun: true` first for non-trivial changes: same diff, findings and expectations, then the state is restored.',
      '`expect`: assertions evaluated after the batch on { state, diff, results } (state = bpm, fixtures, groups, modifiers, livePages, selection; results = per-op output values). Each: { path, eq|ne|gt|gte|lt|lte|within|oneOf|contains|exists }, `*` fans out, e.g. { "path": "results.0.id", "exists": true }.',
      'Result: committed flag, semantic diff, findings (errors/warnings with hints), expectation results. Then use `observe` to check how the change actually looks.',
      'Get input schemas with `describe` first. Coordinates are normalized 0–1 world space.',
    ].join('\n'),
    inputSchema: toolInputSchema(ApplyRequestSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, title: 'Apply operations' },
    async run(host, input, ctx) {
      const parsed = parseInput('apply', ApplyRequestSchema, input);
      if (!parsed.ok) return parsed.output;
      const request = parsed.value;
      try {
        const result = await host.apply(request, { actor: ctx.actor, signal: ctx.signal });
        const failedExpectation = result.expectations?.some(e => !e.pass) ?? false;
        const failed = result.findings.some(f => f.level === 'error') || failedExpectation;
        return textAndJson(summarizeApply(result, request.dryRun ?? false, request.label), result, failed);
      }
      catch (err) {
        return errorOutput(`apply failed: ${messageOf(err)}`);
      }
    },
  };
}
