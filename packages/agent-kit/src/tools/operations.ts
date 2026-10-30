/**
 * `operations` tool: list the operation catalog (ids + one-line summaries).
 */
import { APPLY_ENVELOPE } from '../envelope';
import { OperationQuerySchema } from '../operation';
import { parseInput, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Reminder appended to every listing: how to describe and how to call an operation. */
export const OPERATIONS_FOOTER = `Call shape: ${APPLY_ENVELOPE} (queries also: inspect { "selector": { "op": "<id>", "input": { … } } }). Input schema + example call: describe { "id": "<operation id>" }.`;

/** Creates the \`operations\` tool. */
export function createOperationsTool(): ToolDefinition {
  return {
    name: 'operations',
    description: [
      'List the operations you can run (id, kind, one-line summary).',
      'Kinds: "query" (read; run via `inspect` { op, input } or inside `apply`), "mutation" (undoable change; via `apply`), "action" (side effect outside the undo history, e.g. plugins.build; via `apply`, skipped on dryRun).',
      'Filter with `search` (substring over id + description), `namespace` (e.g. "modifiers", "live", "fixtures", "plugins") or `kind`.',
      'Next: `describe { "id": "<operation id>" }` for its input schema and a ready-to-copy call; then run it as',
      `${APPLY_ENVELOPE}.`,
    ].join('\n'),
    inputSchema: toolInputSchema(OperationQuerySchema),
    annotations: { readOnlyHint: true, title: 'List operations' },
    async run(host, input) {
      const parsed = parseInput('operations', OperationQuerySchema, input);
      if (!parsed.ok) return parsed.output;
      const list = host.listOperations(parsed.value);
      const summary = list.length
        ? `${list.length} operation(s):\n${list.map(o => `${o.id} (${o.kind}) — ${o.summary}`).join('\n')}\n\n${OPERATIONS_FOOTER}`
        : 'No operation matches. Call `operations` without filters to see the full catalog.';
      return textAndJson(summary, list);
    },
  };
}
