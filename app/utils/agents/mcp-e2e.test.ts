/**
 * End-to-end smoke test of the MCP loop (plan M3):
 *
 *   MCP SDK client ─stdio─► `pixelmapper-mcp` CLI (spawned with Bun)
 *                                 ◄─ws── bridge client ─► real app host + core operations
 *
 * Verifies tool listing, inspect, apply with actor attribution / undo label,
 * describe guides and screenshot image content (not cut by the text output
 * budget) through the real CLI process. Skipped when `bun` is
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
/** Small text budget of the CLI under test (the fake image is larger). */
const MAX_OUTPUT_CHARS = 20_000;
/** Fake PNG payload: PNG signature + filler, ~60 000 base64 characters. */
const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(45_000, 7)]).toString('base64');

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
        PIXELMAPPER_MCP_MAX_OUTPUT_CHARS: String(MAX_OUTPUT_CHARS),
      },
      stderr: 'ignore',
    });
    mcp = new Client({ name: 'e2e-smoke', version: '1.0.0' });
    await mcp.connect(transport);

    // App side: real host with the core catalog, bridge client over `ws`.
    const host = createAppAgentHost({
      registry: registerCoreOperations(createOperationRegistry()),
      observe: async () => null,
      // Node has no OffscreenCanvas: a fixed payload stands in for the PNG.
      screenshot: { rasterize: async scene => ({ data: FAKE_PNG, width: scene.width, height: scene.height }), editorCanvas: () => null },
    });
    const tools = createTools({ screenshot: true });
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
    expect(names).toEqual(expect.arrayContaining(['inspect', 'operations', 'describe', 'apply', 'observe', 'screenshot', 'pixelmapper_status']));
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

  it('returns screenshot image content intact, outside the text budget', async () => {
    const result = await mcp.callTool({ name: 'screenshot', arguments: { size: 512 } });
    const content = (result as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }).content;
    expect(result.isError).toBeFalsy();
    expect(FAKE_PNG.length).toBeGreaterThan(MAX_OUTPUT_CHARS);
    expect(content.find(c => c.type === 'image')).toEqual({ type: 'image', data: FAKE_PNG, mimeType: 'image/png' });
    expect(firstText(result)).toContain('Layout view');
    expect(content.some(c => c.text?.includes('[output truncated'))).toBe(false);
  });

  it('reports a readable error for the canvas view without an editor', async () => {
    const result = await mcp.callTool({ name: 'screenshot', arguments: { view: 'canvas' } });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Use view "layout"');
  });
});
