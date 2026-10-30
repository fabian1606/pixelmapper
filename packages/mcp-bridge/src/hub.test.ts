// @vitest-environment node
// ── Hub / relay transport tests ─────────────────────────
//
// A fake app connects to a real hub over WebSocket on a random loopback port.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BridgeCoordinator } from './coordinator';
import { Hub } from './hub';
import { BridgeError, CLOSE_CODES } from './protocol';
import { RelayClient } from './relay-client';
import { FakeApp, SAMPLE_TOOLS, TEST_TOKEN, freePort, testConfig, waitFor } from './test-utils';

/** Everything opened by a test, closed in `afterEach`. */
const cleanup: Array<() => Promise<void>> = [];

beforeAll(() => {
  process.env.PIXELMAPPER_MCP_QUIET = '1';
});

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!().catch(() => {});
});

/** Starts a hub on a random port and registers it for cleanup. */
async function startHub(overrides = {}): Promise<Hub> {
  const hub = await Hub.start(testConfig(overrides), TEST_TOKEN);
  cleanup.push(() => hub.close());
  return hub;
}

/** Connects a fake app and registers it for cleanup. */
async function connectApp(port: number, options = {}): Promise<FakeApp> {
  const app = await FakeApp.connect(port, options);
  cleanup.push(() => app.close());
  return app;
}

describe('hub handshake', () => {
  it('sends hello, accepts the app and exposes its tools', async () => {
    const hub = await startHub();
    const changes: number[] = [];
    hub.onChange(() => changes.push(1));
    const app = await connectApp(hub.port);

    expect(app.of('hello')[0]).toMatchObject({ role: 'hub', protocol: '1.0.0' });
    expect(app.of('welcome')[0]).toMatchObject({ role: 'app', callTimeoutMs: 2_000 });
    expect(hub.getState()).toMatchObject({ mode: 'hub', appConnected: true, app: { platform: 'web' } });
    expect(hub.getState().tools.map((t) => t.name)).toEqual(['inspect', 'observe']);
    expect(changes.length).toBe(1);
  });

  it('rejects a wrong token with error + close 4001', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port, { token: 'b'.repeat(64) });
    await waitFor(() => app.closeCode !== null);

    expect(app.of('error')[0]).toMatchObject({ code: 'unauthorized' });
    expect(app.closeCode).toBe(CLOSE_CODES.unauthorized);
    expect(hub.getState().appConnected).toBe(false);
  });

  it('rejects a foreign Origin at the HTTP upgrade (403)', async () => {
    const hub = await startHub();
    await expect(FakeApp.connect(hub.port, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    expect(hub.getState().appConnected).toBe(false);
  });

  it('rejects the app role without an Origin header', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port, { origin: null });
    await waitFor(() => app.closeCode !== null);
    expect(app.of('error')[0]).toMatchObject({ code: 'origin_rejected' });
  });

  it('accepts a configured custom Origin', async () => {
    const hub = await startHub({ allowedOrigins: ['http://localhost:4000'] });
    const app = await connectApp(hub.port, { origin: 'http://localhost:4000' });
    expect(app.of('welcome')).toHaveLength(1);
  });

  it('rejects an incompatible protocol major with 4002', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port, { protocol: '2.0.0' });
    await waitFor(() => app.closeCode !== null);
    expect(app.of('error')[0]).toMatchObject({ code: 'protocol_mismatch' });
    expect(app.closeCode).toBe(CLOSE_CODES.protocolMismatch);
  });

  it('closes clients that never send hello', async () => {
    const hub = await startHub({ helloTimeoutMs: 100 });
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}`, { headers: { origin: 'http://localhost:3000' } });
    const code = await new Promise<number>((resolve) => ws.on('close', resolve));
    expect(code).toBe(CLOSE_CODES.helloTimeout);
  });

  it('drops invalid tool definitions but keeps valid ones', async () => {
    const hub = await startHub();
    await connectApp(hub.port, {
      tools: [...SAMPLE_TOOLS, { name: 'bad name!', inputSchema: { type: 'object' } }, { name: 'x' } as never],
    });
    expect(hub.getState().tools.map((t) => t.name)).toEqual(['inspect', 'observe']);
  });
});

describe('hub calls', () => {
  it('round-trips call → result with client attribution', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port);
    const outcome = await hub.call({ tool: 'inspect', input: { selector: 'project' }, client: 'claude-code' });

    expect(app.of('call')[0]).toMatchObject({ tool: 'inspect', input: { selector: 'project' }, client: 'claude-code' });
    expect(outcome.content).toEqual([{ type: 'text', text: 'ran inspect for claude-code' }]);
  });

  it('passes app errors through with their code', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port);
    app.onCall = () => ({ type: 'error', code: 'unknown_tool', message: 'nope' });
    await expect(hub.call({ tool: 'x', input: {}, client: 'c' })).rejects.toMatchObject({ code: 'unknown_tool' });
  });

  it('fails with no_app when nothing is connected', async () => {
    const hub = await startHub();
    const error = await hub.call({ tool: 'inspect', input: {}, client: 'c' }).catch((e: BridgeError) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe('no_app');
    expect((error as BridgeError).message).toContain('Settings → External agents');
  });

  it('times out, sends cancel and ignores the late result', async () => {
    const hub = await startHub({ callTimeoutMs: 100 });
    const app = await connectApp(hub.port);
    app.onCall = () => null;
    await expect(hub.call({ tool: 'observe', input: {}, client: 'c' })).rejects.toMatchObject({ code: 'timeout' });
    await waitFor(() => app.of('cancel').length === 1);
    expect(app.of('cancel')[0]).toMatchObject({ reason: 'timeout' });
  });

  it('latest app wins; the old one is superseded and its calls fail', async () => {
    const hub = await startHub();
    const first = await connectApp(hub.port);
    first.onCall = () => null;
    // Catch immediately: the rejection happens while the second app connects.
    const pending = hub.call({ tool: 'observe', input: {}, client: 'c' }).catch((e: BridgeError) => e);
    await waitFor(() => first.of('call').length === 1);

    const second = await connectApp(hub.port, { tools: [SAMPLE_TOOLS[0]!] });
    expect(await pending).toMatchObject({ code: 'app_disconnected' });
    await waitFor(() => first.closeCode !== null);
    expect(first.of('superseded')).toHaveLength(1);
    expect(first.closeCode).toBe(CLOSE_CODES.superseded);
    expect(hub.getState().tools.map((t) => t.name)).toEqual(['inspect']);

    const outcome = await hub.call({ tool: 'inspect', input: {}, client: 'c' });
    expect(outcome.content[0]).toMatchObject({ type: 'text' });
    expect(second.of('call')).toHaveLength(1);
  });

  it('re-announced tools replace the list and notify listeners', async () => {
    const hub = await startHub();
    const app = await connectApp(hub.port);
    let changes = 0;
    hub.onChange(() => changes++);
    app.send({ type: 'tools', tools: [SAMPLE_TOOLS[1]] });
    await waitFor(() => changes === 1);
    expect(hub.getState().tools.map((t) => t.name)).toEqual(['observe']);
  });
});

describe('relay mode', () => {
  it('forwards relay calls through the hub with the relay client name', async () => {
    const hub = await startHub();
    const config = testConfig({ port: hub.port });
    const relay = await RelayClient.connect(config, TEST_TOKEN, { name: 'claude-desktop' });
    cleanup.push(() => relay.close());
    expect(relay.getState()).toMatchObject({ mode: 'relay', appConnected: false });

    const app = await connectApp(hub.port);
    await waitFor(() => relay.getState().appConnected);
    expect(relay.getState().tools.map((t) => t.name)).toEqual(['inspect', 'observe']);

    const outcome = await relay.call({ tool: 'inspect', input: { selector: 'selection' }, client: 'claude-desktop' });
    expect(outcome.content).toEqual([{ type: 'text', text: 'ran inspect for claude-desktop' }]);
    expect(app.of('call')[0]).toMatchObject({ client: 'claude-desktop' });

    app.onCall = () => ({ type: 'error', code: 'tool_failed', message: 'Nothing selected' });
    await expect(relay.call({ tool: 'inspect', input: {}, client: 'claude-desktop' })).rejects.toMatchObject({
      code: 'tool_failed',
      message: 'Nothing selected',
    });
  });

  it('relays get no_app when the hub has no app', async () => {
    const hub = await startHub();
    const relay = await RelayClient.connect(testConfig({ port: hub.port }), TEST_TOKEN, { name: 'x' });
    cleanup.push(() => relay.close());
    await expect(relay.call({ tool: 'inspect', input: {}, client: 'x' })).rejects.toMatchObject({ code: 'no_app' });
  });

  it('rejects a relay with the wrong token', async () => {
    const hub = await startHub();
    await expect(RelayClient.connect(testConfig({ port: hub.port }), 'c'.repeat(64), { name: 'x' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('second coordinator relays; it takes over the port when the hub dies', async () => {
    const port = await freePort();
    const config = testConfig({ port });
    const first = new BridgeCoordinator(config, TEST_TOKEN, () => ({ name: 'claude-code' }));
    const second = new BridgeCoordinator(config, TEST_TOKEN, () => ({ name: 'claude-desktop' }));
    cleanup.push(() => first.close(), () => second.close());
    await first.start();
    await second.start();
    expect(first.getState().mode).toBe('hub');
    expect(second.getState().mode).toBe('relay');

    await connectApp(port);
    await waitFor(() => second.getState().appConnected);
    const viaRelay = await second.call({ tool: 'inspect', input: {}, client: 'claude-desktop' });
    expect(viaRelay.content[0]).toMatchObject({ text: 'ran inspect for claude-desktop' });

    await first.close();
    await waitFor(() => second.getState().mode === 'hub', 5_000);
    // The app reconnects to the new hub (client-side backoff in the real app).
    await connectApp(port);
    const afterTakeover = await second.call({ tool: 'observe', input: {}, client: 'claude-desktop' });
    expect(afterTakeover.content[0]).toMatchObject({ text: 'ran observe for claude-desktop' });
  });

  it('a first call waits for the app instead of failing with no_app', async () => {
    // Regression: a freshly spawned process answered its first call with
    // no_app while the relay handshake / app reconnect was still running.
    const port = await freePort();
    const coordinator = new BridgeCoordinator(testConfig({ port, appWaitMs: 3_000 }), TEST_TOKEN, () => ({ name: 'claude-code' }));
    cleanup.push(() => coordinator.close());
    const pending = coordinator.call({ tool: 'inspect', input: {}, client: 'claude-code' });
    await coordinator.start();
    await connectApp(port);
    await expect(pending).resolves.toMatchObject({ content: [{ text: 'ran inspect for claude-code' }] });
  });

  it('still fails with no_app once the grace period is over', async () => {
    const port = await freePort();
    const coordinator = new BridgeCoordinator(testConfig({ port, appWaitMs: 200 }), TEST_TOKEN, () => ({ name: 'claude-code' }));
    cleanup.push(() => coordinator.close());
    await coordinator.start();
    await expect(coordinator.call({ tool: 'inspect', input: {}, client: 'claude-code' })).rejects.toMatchObject({ code: 'no_app' });
  });
});
