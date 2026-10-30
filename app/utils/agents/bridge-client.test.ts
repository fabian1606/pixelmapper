// @vitest-environment node
// ── Bridge client ↔ real hub ────────────────────────────
//
// Starts the real `pixelmapper-mcp` hub in-process on a random port and
// drives the app-side client with `ws` (plus an allowed Origin header).

import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AgentHost, ToolContext, ToolDefinition } from '@pixelmapper/agent-kit';

import { Hub } from '~~/packages/mcp-bridge/src/hub';
import { BridgeError } from '~~/packages/mcp-bridge/src/protocol';
import { TEST_TOKEN, testConfig, waitFor } from '~~/packages/mcp-bridge/src/test-utils';
import { createBridgeClient } from './bridge-client';
import type { BridgeClient, BridgeClientOptions, BridgeSocketCtor } from './bridge-client';
import type { BridgeStatus } from './bridge-status';
import { sanitizeClientName } from './bridge-calls';

// ── Fixtures ────────────────────────────────────

/** Everything opened by a test, closed in `afterEach`. */
const cleanup: Array<() => Promise<void> | void> = [];

beforeAll(() => {
  process.env.PIXELMAPPER_MCP_QUIET = '1';
});

afterEach(async () => {
  while (cleanup.length) await Promise.resolve(cleanup.pop()!()).catch(() => {});
});

/** `ws` WebSocket that sends a browser-like Origin the hub accepts. */
class OriginWebSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { origin: 'http://localhost:3000' } });
  }
}

/** The host is never touched by the stub tools. */
const STUB_HOST = {} as AgentHost;

/** Context seen by the last `echo` call. */
let lastCtx: ToolContext | null = null;
/** Resolves the pending `slow` call when set. */
let slowAborted = false;

/** Stub tools: `echo` answers immediately, `slow` waits for abort. */
function stubTools(): ToolDefinition[] {
  return [
    {
      name: 'echo',
      description: 'Echo the input',
      inputSchema: { type: 'object' },
      async run(_host, input, ctx) {
        lastCtx = ctx;
        return { content: [{ type: 'json', json: input }] };
      },
    },
    {
      name: 'slow',
      description: 'Waits until cancelled',
      inputSchema: { type: 'object' },
      run(_host, _input, ctx) {
        return new Promise((_resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            slowAborted = true;
            reject(new Error('aborted'));
          });
        });
      },
    },
    {
      name: 'boom',
      description: 'Throws',
      inputSchema: { type: 'object' },
      async run() {
        throw new Error('kaputt');
      },
    },
  ];
}

/** Starts a hub on a random port. */
async function startHub(overrides = {}): Promise<Hub> {
  const hub = await Hub.start(testConfig(overrides), TEST_TOKEN);
  cleanup.push(() => hub.close());
  return hub;
}

/** Creates and starts a client against `port`, recording every status. */
function startClient(port: number, overrides: Partial<BridgeClientOptions> = {}) {
  let tools = stubTools();
  const states: BridgeStatus['state'][] = [];
  const client: BridgeClient = createBridgeClient({
    url: `ws://127.0.0.1:${port}`,
    token: TEST_TOKEN,
    app: { name: 'pixelmapper', version: '0.0.0-test', platform: 'web' },
    tools: () => tools,
    host: STUB_HOST,
    WebSocketImpl: OriginWebSocket as unknown as BridgeSocketCtor,
    backoffMs: [20, 40],
    ...overrides,
  });
  client.subscribe((s) => states.push(s.state));
  client.start();
  cleanup.push(() => client.stop());
  return { client, states, setTools: (next: ToolDefinition[]) => { tools = next; } };
}

// ── Tests ───────────────────────────────────────

describe('bridge client', () => {
  it('connects, announces tools and runs calls with the MCP actor', async () => {
    const hub = await startHub();
    const { client } = startClient(hub.port);
    await waitFor(() => client.getStatus().state === 'connected');

    expect(hub.getState().tools.map((t) => t.name)).toEqual(['echo', 'slow', 'boom']);
    expect(hub.getState().app).toMatchObject({ name: 'pixelmapper', platform: 'web' });

    const outcome = await hub.call({ tool: 'echo', input: { a: 1 }, client: 'claude-code' });
    expect(outcome.content).toEqual([{ type: 'json', json: { a: 1 } }]);
    expect(outcome.isError).toBeFalsy();
    expect(lastCtx?.actor).toBe('agent:mcp:claude-code');
    expect(client.getStatus().lastClient).toBe('claude-code');
  });

  it('maps unknown tools and thrown errors to protocol errors', async () => {
    const hub = await startHub();
    const { client } = startClient(hub.port);
    await waitFor(() => client.getStatus().state === 'connected');

    await expect(hub.call({ tool: 'nope', input: {}, client: 'x' })).rejects.toMatchObject({ code: 'unknown_tool' });
    const failed = await hub.call({ tool: 'boom', input: {}, client: 'x' }).catch((e: BridgeError) => e);
    expect(failed).toMatchObject({ code: 'tool_failed', message: 'kaputt' });
  });

  it('aborts the tool signal when the hub cancels', async () => {
    slowAborted = false;
    const hub = await startHub();
    const { client } = startClient(hub.port);
    await waitFor(() => client.getStatus().state === 'connected');

    const controller = new AbortController();
    const pending = hub.call({ tool: 'slow', input: {}, client: 'x', signal: controller.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await waitFor(() => slowAborted);
    expect(await pending).toBeInstanceOf(BridgeError);
  });

  it('re-announces the tool list', async () => {
    const hub = await startHub();
    const { client, setTools } = startClient(hub.port);
    await waitFor(() => client.getStatus().state === 'connected');

    setTools(stubTools().slice(0, 1));
    client.announceTools();
    await waitFor(() => hub.getState().tools.length === 1);
    expect(hub.getState().tools[0]!.name).toBe('echo');
  });

  it('stops after a rejected token (no reconnect)', async () => {
    const hub = await startHub();
    let attempts = 0;
    class CountingSocket extends OriginWebSocket {
      constructor(url: string) {
        super(url);
        attempts++;
      }
    }
    const { client } = startClient(hub.port, {
      token: 'b'.repeat(64),
      WebSocketImpl: CountingSocket as unknown as BridgeSocketCtor,
    });
    await waitFor(() => client.getStatus().state === 'unauthorized');
    expect(client.getStatus().message).toBe('Pairing token rejected');
    await new Promise((r) => setTimeout(r, 120));
    expect(attempts).toBe(1);
    expect(hub.getState().appConnected).toBe(false);
  });

  it('waits and reconnects when the hub appears later', async () => {
    const probe = await startHub();
    const port = probe.port;
    await probe.close();
    const { client } = startClient(port);
    await waitFor(() => client.getStatus().state === 'waiting');

    const hub = await startHub({ port });
    await waitFor(() => client.getStatus().state === 'connected');
    expect(hub.getState().appConnected).toBe(true);
  });

  it('shows superseded and stays down when another window connects', async () => {
    const hub = await startHub();
    const first = startClient(hub.port);
    await waitFor(() => first.client.getStatus().state === 'connected');
    const second = startClient(hub.port);
    await waitFor(() => first.client.getStatus().state === 'superseded');
    await waitFor(() => second.client.getStatus().state === 'connected');
    await new Promise((r) => setTimeout(r, 100));
    expect(first.client.getStatus().state).toBe('superseded');
    expect(second.client.getStatus().state).toBe('connected');
  });
});

describe('sanitizeClientName', () => {
  it('keeps safe names and falls back to unknown', () => {
    expect(sanitizeClientName('claude-code')).toBe('claude-code');
    expect(sanitizeClientName('Claude Desktop 1.0')).toBe('Claude-Desktop-1.0');
    expect(sanitizeClientName('  ')).toBe('unknown');
    expect(sanitizeClientName(undefined)).toBe('unknown');
  });
});
