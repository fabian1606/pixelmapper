// @vitest-environment node
// ── Call runner: oversized results ──────────────────────
//
// A result larger than the hub's frame limit would make the hub drop the
// socket; the runner must answer with an explicit error instead.

import { describe, expect, it } from 'vitest';
import type { AgentHost, ToolDefinition } from '@pixelmapper/agent-kit';

import { MAX_FRAME_BYTES } from '~~/packages/mcp-bridge/src/protocol';
import { CallRunner } from './bridge-calls';

/** A tool that returns one text item of `size` characters. */
function sizedTool(size: number): ToolDefinition {
  return {
    name: 'inspect',
    description: 'test',
    inputSchema: { type: 'object' },
    run: async () => ({ content: [{ type: 'text', text: 'x'.repeat(size) }] }),
  };
}

/** Runs one call and returns the frames the runner sent. */
async function runOnce(tool: ToolDefinition): Promise<Array<Record<string, unknown>>> {
  const sent: Array<Record<string, unknown>> = [];
  const runner = new CallRunner({ tools: () => [tool], host: () => ({}) as AgentHost, send: (f) => sent.push(f) });
  await runner.run({ type: 'call', id: 7, tool: 'inspect', input: {}, client: 'test' });
  return sent;
}

describe('CallRunner frame limit', () => {
  it('sends normal results unchanged', async () => {
    const sent = await runOnce(sizedTool(10));
    expect(sent).toEqual([{ type: 'result', id: 7, content: [{ type: 'text', text: 'x'.repeat(10) }] }]);
  });

  it('answers an oversized result with an explicit tool_failed error', async () => {
    const sent = await runOnce(sizedTool(MAX_FRAME_BYTES + 1));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'error', id: 7, code: 'tool_failed' });
    expect(String(sent[0]!.message)).toMatch(/too large to send .*Narrow the request/);
  });
});
