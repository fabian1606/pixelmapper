/**
 * `inspect` tool: read project state (digest, selection, events, query
 * operations, entities). Read-only.
 */
import { InspectRequestSchema } from '../host';
import { errorOutput, jsonText, messageOf, parseInput, text, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Keys accepted instead of `selector` (agents mix up the tools' key names). */
const SELECTOR_ALIASES = { id: 'selector', ids: 'selector', query: 'selector', target: 'selector' };

/** A top-level `{ op, input }` (no selector) is read as `selector: { op, input }`. */
function liftQuery(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const rec = input as Record<string, unknown>;
  if ('selector' in rec || typeof rec.op !== 'string') return input;
  const { op, input: opInput, ...rest } = rec;
  return { ...rest, selector: { op, input: opInput } };
}

/** Creates the `inspect` tool. */
export function createInspectTool(): ToolDefinition {
  return {
    name: 'inspect',
    description: [
      'Read the current Pixelmapper project. Start every task here.',
      'Workflow: inspect → operations/describe → apply (with dryRun and expect) → observe the result.',
      'Input: { "selector": … } (always the key "selector"):',
      '- "project": compact digest (fixtures with normalized positions, groups, modifier stack, live pages, BPM).',
      '- "selection": what the user has selected in the app.',
      '- "events": recent event log (commands, undo/redo, operations, warnings) with actors; `limit` = newest N (default 50), `filter` { kind, actor, sinceId }.',
      '- { op, input }: run a query operation (see `operations`), e.g. { "selector": { "op": "fixtures.find", "input": { "name": "bar" } } }.',
      '- ["fixture:12", "modifier:abc", "group:g1", "livePage:p1", "liveWidget:w1", …] or plain fixture ids: details of those entities (live mappings use the live.addWidget vocabulary: modifierId, bare paramKey).',
      'detail: "summary" (default) or "full".',
      'Coordinates: normalized world space 0–1, x left→right, y top→bottom on the 2D canvas; z = height above the floor. The default 3D camera looks from the bottom edge, so "front" (audience side) is conventionally high y, "back" low y; the room center is (0.5, 0.5).',
      'Rotation: yaw in degrees, clockwise on the canvas; at 0° a multi-head fixture (LED bar, pixel strip) has head 0 on the left and its heads run toward +x (90° = top→bottom). To place many fixtures use fixtures.arrange (grid/line/circle/distribute/align, orient along/across).',
    ].join('\n'),
    inputSchema: toolInputSchema(InspectRequestSchema),
    annotations: { readOnlyHint: true, title: 'Inspect project' },
    async run(host, input) {
      const parsed = parseInput('inspect', InspectRequestSchema, liftQuery(input), SELECTOR_ALIASES);
      if (!parsed.ok) return parsed.output;
      try {
        const result = await host.inspect(parsed.value);
        return result.text
          ? textAndJson(result.text, result.value)
          : { content: [text(jsonText(result.value))] };
      }
      catch (err) {
        return errorOutput(`inspect failed: ${messageOf(err)}`);
      }
    },
  };
}
