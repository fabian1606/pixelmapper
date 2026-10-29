/**
 * `inspect` tool: read project state (digest, selection, events, query
 * operations, entities). Read-only.
 */
import { InspectRequestSchema } from '../host';
import { errorOutput, messageOf, parseInput, text, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Creates the `inspect` tool. */
export function createInspectTool(): ToolDefinition {
  return {
    name: 'inspect',
    description: [
      'Read the current Pixelmapper project. Start every task here.',
      'Workflow: inspect → operations/describe → apply (with dryRun and expect) → observe the result.',
      'selector:',
      '- "project": compact digest (fixtures with normalized positions, groups, modifier stack, live pages, BPM).',
      '- "selection": what the user has selected in the app.',
      '- "events": recent event log (commands, undo/redo, operations, warnings) with actors; `limit` = newest N (default 50), `filter` { kind, actor, sinceId }.',
      '- { op, input }: run a query operation (see `operations`), e.g. { "op": "fixtures.find", "input": { "name": "bar" } }.',
      '- ["fixture:12", "modifier:abc", "group:g1", "livePage:p1", …] or plain fixture ids: details of those entities.',
      'detail: "summary" (default) or "full".',
      'Coordinates: normalized world space 0–1, x left→right, y top→bottom on the 2D canvas; z = height above the floor.',
    ].join('\n'),
    inputSchema: toolInputSchema(InspectRequestSchema),
    annotations: { readOnlyHint: true, title: 'Inspect project' },
    async run(host, input) {
      const parsed = parseInput('inspect', InspectRequestSchema, input);
      if (!parsed.ok) return parsed.output;
      try {
        const result = await host.inspect(parsed.value);
        return result.text
          ? textAndJson(result.text, result.value)
          : { content: [text(JSON.stringify(result.value, null, 2) ?? 'null')] };
      }
      catch (err) {
        return errorOutput(`inspect failed: ${messageOf(err)}`);
      }
    },
  };
}
