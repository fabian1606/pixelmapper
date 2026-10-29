/**
 * End-to-end smoke test of the MCP loop (plan M3):
 *
 *   MCP SDK client ─stdio─► `pixelmapper-mcp` CLI (spawned with Bun)
 *                                 ◄─ws── bridge client ─► real app host + core operations
 *
 * Verifies tool listing, inspect, apply with actor attribution / undo label
 * and describe guides through the real CLI process. Skipped when `bun` is
 * not on the PATH.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTools } from '@pixelmapper/agent-kit';
import { useHistory } from '~/components/engine/composables/use-history';
import { eventLog } from '~/utils/observability/event-log';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';
import { readApi } from '~/utils/operations/read-api';
import { resetOperationState, seedScene, stubOperationGlobals } from '~/utils/operations/test-utils';
import { freePort, waitFor } from '~~/packages/mcp-bridge/src/test-utils';
import { createBridgeClient, type BridgeClient, type BridgeSocketCtor } from './bridge-client';
import { createAppAgentHost } from './host';

const HAS_BUN = spawnSync('bun', ['--version']).status === 0;
const TOKEN = 'b'.repeat(64);
const CLI = join(__dirname, '../../../packages/mcp-bridge/src/cli.ts');

/** `ws` WebSocket with a browser Origin the hub accepts for the app role. */
class OriginWebSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { origin: 'http://localhost:3000' } });
  }
}

/** Text of the first content item of an MCP tool result. */
function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.find(c => c.type === 'text')?.text ?? '';
}

describe.skipIf(!HAS_BUN)('MCP end to end (CLI over stdio ⇄ app bridge client)', () => {
  let mcp: Client;
  let bridge: BridgeClient;

  beforeAll(async () => {
    stubOperationGlobals();
    resetOperationState();
    seedScene([{ id: 'fx-a', x: 0.2 }, { id: 'fx-b', x: 0.8 }], [{ id: 'g-all', name: 'All', fixtureIds: ['fx-a', 'fx-b'] }]);

    // Isolated CLI state: own port, token file and tool cache.
    const dir = mkdtempSync(join(tmpdir(), 'pm-mcp-e2e-'));
    writeFileSync(join(dir, 'mcp-token'), TOKEN, { mode: 0o600 });
    const port = await freePort();
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', CLI],
      env: {
        ...process.env as Record<string, string>,
        PIXELMAPPER_MCP_PORT: String(port),
        PIXELMAPPER_MCP_TOKEN_FILE: join(dir, 'mcp-token'),
        PIXELMAPPER_MCP_TOOL_CACHE: join(dir, 'mcp-tools.json'),
        PIXELMAPPER_MCP_QUIET: '1',
      },
      stderr: 'ignore',
    });
    mcp = new Client({ name: 'e2e-smoke', version: '1.0.0' });
    await mcp.connect(transport);

    // App side: real host with the core catalog, bridge client over `ws`.
    const host = createAppAgentHost({ registry: registerCoreOperations(createOperationRegistry()), observe: async () => null });
    const tools = createTools();
    bridge = createBridgeClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      app: { name: 'pixelmapper', version: 'test', platform: 'web' },
      tools: () => tools,
      host,
      WebSocketImpl: OriginWebSocket as unknown as BridgeSocketCtor,
      backoffMs: [50],
    });
    bridge.start();
    await waitFor(() => bridge.getStatus().state === 'connected', 10_000);
  }, 30_000);

  afterAll(async () => {
    bridge?.stop();
    await mcp?.close();
  });

  it('lists the app tools plus pixelmapper_status', async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['inspect', 'operations', 'describe', 'apply', 'observe', 'pixelmapper_status']));
  });

  it('inspects the project through the CLI', async () => {
    const result = await mcp.callTool({ name: 'inspect', arguments: { selector: 'project' } });
    expect(firstText(result)).toContain('2 fixtures');
  });

  it('applies a change as one undo step attributed to agent:mcp:<client>', async () => {
    const result = await mcp.callTool({
      name: 'apply',
      arguments: { label: 'Wave', ops: [{ op: 'modifiers.add', input: { plugin: 'waveform', targets: { groupIds: ['g-all'] } } }] },
    });
    expect(result.isError).toBeFalsy();
    expect(readApi.modifiers()).toHaveLength(1);
    expect(useHistory().lastDescription.value).toBe('AI: Wave');
    const actors = new Set(eventLog.list({ kind: 'operation' }).map(e => e.actor));
    expect([...actors].some(a => a.startsWith('agent:mcp:e2e'))).toBe(true);
    useHistory().undo();
    expect(readApi.modifiers()).toHaveLength(0);
  });

  it('serves guide topics through describe', async () => {
    const result = await mcp.callTool({ name: 'describe', arguments: { id: 'guide:modifier-design' } });
    expect(firstText(result)).toContain('# Modifier Design Principles');
  });
});
