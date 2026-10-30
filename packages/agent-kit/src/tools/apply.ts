/**
 * `apply` tool: run a batch of operations as one undoable transaction.
 */
import { ApplyRequestSchema, type ApplyResult } from '../apply';
import { normalizeApplyRequest } from '../envelope';
import type { ExpectationResult } from '../expectation';
import type { Finding } from '../finding';
import type { SemanticChange } from '../apply';
import { errorOutput, messageOf, parseInput, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Max diff lines in the text summary (the JSON part has all of them). */
const MAX_DIFF_LINES = 40;
/** Entity ids named per grouped diff line before "… (n)". */
const MAX_GROUP_IDS = 4;

/** Compact value for a diff line. */
function short(value: unknown): string {
  const s = JSON.stringify(value);
  if (s === undefined) return '∅';
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** `fixture bar-1, bar-2, … (21)` for entities of one type. */
function entityList(entities: readonly string[]): string {
  const [type] = entities[0]!.split(':');
  const ids = entities.map(e => e.slice(e.indexOf(':') + 1));
  const sameType = entities.every(e => e.startsWith(`${type}:`));
  const shown = (sameType ? ids : entities).slice(0, MAX_GROUP_IDS).join(', ');
  const more = entities.length > MAX_GROUP_IDS ? `, … (${entities.length})` : '';
  return `${sameType && entities.length > 1 ? `${type} ` : sameType ? `${type}:` : ''}${shown}${more}`;
}

/**
 * Compact diff lines: added / removed entities with their summary first,
 * then one line per entity with all its field changes — entities with the
 * same changes share a line (`fixture bar-1, bar-2, … (21): channels.3.value 0 → 255`).
 */
export function diffLines(diff: readonly SemanticChange[]): string[] {
  const lines: string[] = [];
  const perEntity = new Map<string, string[]>();
  for (const c of diff) {
    if (c.field === 'added') lines.push(`+ ${c.entity}: ${typeof c.to === 'string' ? c.to : short(c.to)}`);
    else if (c.field === 'removed') lines.push(`− ${c.entity}: ${typeof c.from === 'string' ? c.from : short(c.from)}`);
    else perEntity.set(c.entity, [...(perEntity.get(c.entity) ?? []), `${c.field} ${short(c.from)} → ${short(c.to)}`]);
  }
  // Skip field changes of entities that were just added (their summary says it).
  const added = new Set(diff.filter(c => c.field === 'added').map(c => c.entity));
  const groups = new Map<string, string[]>();
  for (const [entity, changes] of perEntity) {
    if (added.has(entity)) continue;
    const key = changes.join(', ');
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }
  for (const [changes, entities] of groups) lines.push(`${entityList(entities)}: ${changes}`);
  return lines;
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
  // Actions (e.g. plugins.build, modifiers.trigger) run outside history, so
  // a batch of only actions commits nothing even when every action succeeded
  // — and may still change state (a trigger press shows up in the diff).
  const actionsRan = result.results.some(r => r.kind === 'action' && !r.skipped);
  const head = result.committed
    ? `Committed "${label}" as one undo step (${result.undoGroupId ?? 'no id'}).`
    : dryRun ? `Dry run of "${label}": nothing was changed.`
      : actionsRan && !result.findings.some(f => f.level === 'error')
        ? `Ran "${label}": action results below (actions are not part of undo history).`
        : `Not committed: "${label}" was rolled back or changed nothing.`;
  const entityCount = new Set(result.diff.map(c => c.entity)).size;
  const compact = diffLines(result.diff);
  const lines = [head, `${result.diff.length} change(s) on ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}:`];
  for (const l of compact.slice(0, MAX_DIFF_LINES)) lines.push(`  ${l}`);
  if (compact.length > MAX_DIFF_LINES) lines.push(`  … ${compact.length - MAX_DIFF_LINES} more line(s) (see the JSON diff)`);
  if (result.findings.length) lines.push('Findings:', ...findingLines(result.findings).map(l => `  ${l}`));
  if (result.expectations?.length) lines.push('Expectations:', ...expectationLines(result.expectations).map(l => `  ${l}`));
  return lines.join('\n');
}

/** Creates the `apply` tool. */
export function createApplyTool(): ToolDefinition {
  return {
    name: 'apply',
    description: [
      'Change the project: run a batch of operations as ONE transaction and one undo step labelled "AI: <label>" in the app.',
      'Call shape — each op entry is { "op": "<operation id>", "input": { …that operation\'s input… } }; the operation\'s keys go INSIDE "input":',
      '{ "label": "Move bar", "ops": [ { "op": "fixtures.move", "input": { "moves": [ { "fixtureId": "fx-1", "x": 0.25, "y": 0.5 } ] } } ], "dryRun": true }',
      '`describe { "id": "<operation id>" }` shows each operation\'s input and a ready-to-copy call. (Input keys placed next to "op" are folded into "input" with an info note.)',
      'Later ops see the effects of earlier ones. Any error (unknown op, invalid input, failed verification) rolls the whole batch back.',
      'Use `dryRun: true` first for non-trivial changes: same diff, findings and expectations, then the state is restored.',
      '`expect`: assertions evaluated after the batch on { state, diff, results } (state = bpm, fixtures, groups, modifiers (as in modifiers.list: blend, spread, speed.value), livePages, selection; results = per-op output values, so `results.0.modifierId`, not `results.0.value.modifierId`). Each: { path, eq|ne|gt|gte|lt|lte|within|oneOf|contains|exists }, `*` fans out, e.g. { "path": "results.0.id", "exists": true }.',
      'A failed `expect` assertion marks the call as an error but does NOT roll back (only op errors do): use dryRun + expect to check before committing.',
      'Result: committed flag, field-level diff ({ entity, field, from, to }; a new or removed entity is ONE "added"/"removed" entry with a one-line summary), affected entities as { entity, summary } (`detail: "full"` adds each complete view), findings (errors/warnings with hints), expectation results. Then use `observe` to check how the change actually looks.',
      'Coordinates are normalized 0–1 world space.',
    ].join('\n'),
    inputSchema: toolInputSchema(ApplyRequestSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, title: 'Apply operations' },
    async run(host, input, ctx) {
      // Lenient envelope: fold input keys placed next to `op` into `input`.
      const normalized = normalizeApplyRequest(input);
      const envelopeErrors = normalized.findings.filter(f => f.level === 'error');
      if (envelopeErrors.length) return errorOutput(envelopeErrors.map(f => f.message).join('\n'));
      const parsed = parseInput('apply', ApplyRequestSchema, normalized.request);
      if (!parsed.ok) return parsed.output;
      const request = parsed.value;
      try {
        const applied = await host.apply(request, { actor: ctx.actor, signal: ctx.signal });
        const result = normalized.findings.length ? { ...applied, findings: [...normalized.findings, ...applied.findings] } : applied;
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
