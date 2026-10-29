/**
 * `operations` tool: list the operation catalog (ids + one-line summaries).
 */
import { OperationQuerySchema } from '../operation';
import { parseInput, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Creates the `operations` tool. */
export function createOperationsTool(): ToolDefinition {
  return {
    name: 'operations',
    description: [
      'List the operations you can run (id, kind, one-line summary).',
      'Kinds: "query" (read; run via `inspect` { op, input } or inside `apply`), "mutation" (undoable change; via `apply`), "action" (side effect outside the undo history, e.g. plugins.build; via `apply`, skipped on dryRun).',
      'Filter with `search` (substring over id + description), `namespace` (e.g. "modifiers", "live", "fixtures", "plugins") or `kind`.',
      'Next: `describe` an operation for its JSON input schema and examples before using it in `apply`.',
    ].join('\n'),
    inputSchema: toolInputSchema(OperationQuerySchema),
    annotations: { readOnlyHint: true, title: 'List operations' },
    async run(host, input) {
      const parsed = parseInput('operations', OperationQuerySchema, input);
      if (!parsed.ok) return parsed.output;
      const list = host.listOperations(parsed.value);
      const summary = list.length
        ? `${list.length} operation(s):\n${list.map(o => `${o.id} (${o.kind}) — ${o.summary}`).join('\n')}`
        : 'No operation matches. Call `operations` without filters to see the full catalog.';
      return textAndJson(summary, list);
    },
  };
}
