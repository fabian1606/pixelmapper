/**
 * `describe` tool: full description of an operation (JSON schemas,
 * examples) or a guide topic (`guide:<topic>`).
 */
import { z } from 'zod';
import type { AgentHost } from '../host';
import { errorOutput, parseInput, text, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition, ToolOutput } from './types';

/** Input schema of `describe`. */
export const DescribeInputSchema = z.object({
  id: z.string().min(1).describe('Operation id (e.g. "modifiers.add") or guide topic ("guide:plugin-authoring"; "guide:" lists all topics).'),
});

/** Prefix of guide topic ids. */
export const GUIDE_PREFIX = 'guide:';

/** Text listing of the guide topics. */
function topicList(host: AgentHost): string {
  return host.guides.list().map(g => `- ${g.id} — ${g.title}`).join('\n') || '(no guides available)';
}

/**
 * Ids similar to an unknown one: same namespace first (prefix matches of
 * the name before others), then a substring search over the name.
 */
function similarOperations(host: AgentHost, id: string): string[] {
  const [namespace = id, name = ''] = id.split(/[./]/);
  const inNamespace = host.listOperations({ namespace }).map(o => o.id);
  const key = name.toLowerCase();
  const ranked = inNamespace.filter(o => key && o.toLowerCase().includes(`.${key}`))
    .concat(inNamespace)
    .concat(name ? host.listOperations({ search: name }).map(o => o.id) : []);
  return [...new Set(ranked)].slice(0, 8);
}

/** Serves a guide topic, or lists the topics when the id is empty / unknown. */
async function describeGuide(host: AgentHost, id: string): Promise<ToolOutput> {
  if (id === GUIDE_PREFIX) return { content: [text(`Guide topics:\n${topicList(host)}`)] };
  const markdown = await host.guides.get(id);
  if (markdown == null) return errorOutput(`Unknown guide topic "${id}". Available topics:\n${topicList(host)}`);
  return { content: [text(markdown)] };
}

/** Creates the `describe` tool. */
export function createDescribeTool(): ToolDefinition {
  return {
    name: 'describe',
    description: [
      'Everything needed to call an operation: full description (units, coordinate spaces), JSON input/output schema and examples. Call it before using an operation in `apply` for the first time.',
      'Also serves guides: id "guide:" lists topics, e.g. "guide:plugin-authoring" (write content plugins for plugins.build), "guide:modifier-design", "guide:plugin-sdk" (SDK type definitions).',
    ].join('\n'),
    inputSchema: toolInputSchema(DescribeInputSchema),
    annotations: { readOnlyHint: true, title: 'Describe operation or guide' },
    async run(host, input) {
      const parsed = parseInput('describe', DescribeInputSchema, input);
      if (!parsed.ok) return parsed.output;
      const { id } = parsed.value;
      if (id.startsWith(GUIDE_PREFIX)) return describeGuide(host, id);
      const description = host.describeOperation(id);
      if (!description) {
        const similar = similarOperations(host, id);
        return errorOutput(`Unknown operation "${id}".${similar.length ? ` Did you mean: ${similar.join(', ')}?` : ' Use `operations` to list ids.'}`);
      }
      return textAndJson(`${description.id} (${description.kind})\n\n${description.description}`, description);
    },
  };
}
