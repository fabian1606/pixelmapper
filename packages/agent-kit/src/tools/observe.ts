/**
 * `observe` tool: render / capture output and return a compact text report.
 */
import { ObserveRequestSchema } from '../observe';
import { errorOutput, messageOf, parseInput, textAndJson, toolInputSchema } from './shared';
import type { ToolDefinition } from './types';

/** Creates the `observe` tool. */
export function createObserveTool(): ToolDefinition {
  return {
    name: 'observe',
    description: [
      'See what the lights actually do. Returns a compact text report (range, color, temporal period / beat lock, spatial pattern such as chase direction or radiating from a point) plus feature JSON.',
      'mode "live": capture the running output over `window` (default 2 s from now). mode "preview": render a modifier (`modifierId`) or a plugin (`plugin: { ref, params }`) headlessly on the real fixture positions — deterministic, can look ahead; default when modifierId/plugin is set.',
      'targets: "all", "selection", fixture/group ids, or a filter { ids | fixtureIds, groupIds, kind, signature, channelTypes, name } (a modifier\'s targets can be passed as they are; unknown keys are an error). detail: "group" (default), "fixture" (every fixture line), "raw" (+ per-frame values per fixture and head).',
      '`expect`: assertions on the feature JSON (same shape as in `apply`), e.g. { "path": "groups.*.temporal.hz", "within": [0.9, 1.1] }. Use it after `apply` to verify the intent.',
    ].join('\n'),
    inputSchema: toolInputSchema(ObserveRequestSchema),
    annotations: { readOnlyHint: true, title: 'Observe output' },
    async run(host, input, ctx) {
      const parsed = parseInput('observe', ObserveRequestSchema, input);
      if (!parsed.ok) return parsed.output;
      try {
        const report = await host.observe(parsed.value, { actor: ctx.actor, signal: ctx.signal });
        const lines = [report.text];
        if (report.expectations.length) lines.push('Expectations:', ...report.expectations.map(e => `  ${e.message}`));
        if (report.findings?.length) lines.push('Findings:', ...report.findings.map(f => `  ${f.level.toUpperCase()} ${f.code}: ${f.message}`));
        const failed = report.expectations.some(e => !e.pass) || (report.findings?.some(f => f.level === 'error') ?? false);
        return textAndJson(lines.join('\n'), report, failed);
      }
      catch (err) {
        return errorOutput(`observe failed: ${messageOf(err)}`);
      }
    },
  };
}
