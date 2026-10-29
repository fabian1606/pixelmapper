// ── Test helpers ────────────────────────────────────────
//
// A fake Pixelmapper app speaking the bridge protocol over `ws`, plus config
// and port helpers. Only imported by `*.test.ts`.

import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

import type { BridgeConfig } from './config';
import { DEFAULT_ALLOWED_ORIGINS } from './config';
import { PROTOCOL_VERSION, parseFrame } from './protocol';
import type { Frame, ToolDefinition } from './protocol';

/** Token used by all tests. */
export const TEST_TOKEN = 'a'.repeat(64);

/** Builds a config for tests (no disk cache, short timeouts). */
export function testConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
    tokenFile: '/nonexistent',
    toolCacheFile: null,
    callTimeoutMs: 2_000,
    helloTimeoutMs: 1_000,
    skillsDir: '/nonexistent',
    ...overrides,
  };
}

/** Finds a free loopback port. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Polls `predicate` until true or the timeout elapses. */
export async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Sample tool definitions announced by the fake app. */
export const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: 'inspect',
    description: 'Inspect the project',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
  },
  { name: 'observe', description: 'Observe output', inputSchema: { type: 'object' } },
];

/** Options of {@link FakeApp.connect}. */
export interface FakeAppOptions {
  origin?: string | null;
  token?: string;
  protocol?: string;
  role?: 'app' | 'relay';
  tools?: ToolDefinition[];
}

/** Minimal app-side client: records every frame, answers calls via a handler. */
export class FakeApp {
  readonly frames: Frame[] = [];
  closeCode: number | null = null;
  /** Answers `call` frames; return a frame (without `id`) or `null` to stay silent. */
  onCall: (call: Frame) => Record<string, unknown> | null = (call) => ({
    type: 'result',
    content: [{ type: 'text', text: `ran ${String(call.tool)} for ${String(call.client)}` }],
  });

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const frame = parseFrame(data.toString());
      if (!frame) return;
      this.frames.push(frame);
      if (frame.type === 'call') {
        const reply = this.onCall(frame);
        if (reply) this.send({ ...reply, id: frame.id });
      }
    });
    ws.on('close', (code) => {
      this.closeCode = code;
    });
  }

  /**
   * Opens a socket and performs the handshake. Resolves after `welcome`,
   * `error`/close, or rejects when the upgrade itself is refused (HTTP status).
   */
  static async connect(port: number, options: FakeAppOptions = {}): Promise<FakeApp> {
    const origin = options.origin === undefined ? 'http://localhost:3000' : options.origin;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { headers: { origin } } : {});
    const app = new FakeApp(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
      ws.once('open', () => resolve());
    });
    await waitFor(() => app.frames.some((f) => f.type === 'hello'));
    app.send({
      type: 'hello',
      role: options.role ?? 'app',
      protocol: options.protocol ?? PROTOCOL_VERSION,
      token: options.token ?? TEST_TOKEN,
      app: { name: 'pixelmapper', version: '0.0.0-test', platform: 'web' },
      tools: options.tools ?? SAMPLE_TOOLS,
    });
    await waitFor(() => app.closeCode !== null || app.frames.some((f) => f.type === 'welcome' || f.type === 'error'));
    return app;
  }

  /** Sends a JSON frame. */
  send(frame: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Frames of a given type. */
  of(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type);
  }

  /** Closes the socket and waits for the close event. */
  async close(): Promise<void> {
    if (this.closeCode !== null) return;
    this.ws.close();
    await waitFor(() => this.closeCode !== null);
  }
}
