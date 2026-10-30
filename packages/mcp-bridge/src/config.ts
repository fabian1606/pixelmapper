// ── Runtime configuration ───────────────────────────────
//
// All knobs come from environment variables so the CLI can be launched by MCP
// clients without extra arguments. Tests build configs directly.

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MAX_OUTPUT_CHARS } from './output-limit';

/** Default WebSocket port of the hub (Art-Net bridge uses 7777). */
export const DEFAULT_PORT = 7778;

/** Default call timeout; `observe` may take several seconds. */
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

/** Default grace period a call waits for the app (see `BridgeConfig.appWaitMs`). */
export const DEFAULT_APP_WAIT_MS = 8_000;

/** Origins allowed to connect as `app` by default (Nuxt dev + Tauri). */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
  'http://tauri.localhost',
];

/** Fully resolved configuration of one CLI process. */
export interface BridgeConfig {
  /** Loopback port of the hub. `0` picks a free port (tests). */
  port: number;
  /** Bind address; always loopback. */
  host: string;
  /** Allowed `Origin`s for the `app` role, or `'*'` to disable the check. */
  allowedOrigins: string[] | '*';
  /** Path of the pairing token file. */
  tokenFile: string;
  /** Path of the last-known tool list cache (`null` disables caching). */
  toolCacheFile: string | null;
  /** How long the hub waits for a `result` / `error`. */
  callTimeoutMs: number;
  /** How long a client may take to send its `hello`. */
  helloTimeoutMs: number;
  /**
   * How long a tool call waits for a backend with a connected app before it
   * fails with `no_app` (covers process start-up, relay handshake and the
   * app's reconnect backoff). Default {@link DEFAULT_APP_WAIT_MS}.
   */
  appWaitMs?: number;
  /** Root directory scanned for `**\/prompts/*.md`. */
  skillsDir: string;
  /**
   * Character budget of one tool result sent to the MCP client; larger
   * results are cut with an explicit notice (see `output-limit.ts`).
   */
  maxOutputChars?: number;
}

/** Directory of the Pixelmapper user data (`~/.pixelmapper`). */
export function pixelmapperHome(): string {
  return join(homedir(), '.pixelmapper');
}

/** Default skills directory: `<repo>/docs/ai/skills`, resolved relative to this package. */
export function defaultSkillsDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '../../../docs/ai/skills');
}

/** Parses a positive integer env value, falling back to `fallback`. */
function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Builds the configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const origins = env.PIXELMAPPER_MCP_ORIGINS?.trim();
  return {
    port: intFromEnv(env.PIXELMAPPER_MCP_PORT, DEFAULT_PORT),
    host: '127.0.0.1',
    allowedOrigins: !origins
      ? DEFAULT_ALLOWED_ORIGINS
      : origins === '*'
        ? '*'
        : origins.split(',').map((o) => o.trim()).filter(Boolean),
    tokenFile: env.PIXELMAPPER_MCP_TOKEN_FILE || join(pixelmapperHome(), 'mcp-token'),
    toolCacheFile: env.PIXELMAPPER_MCP_TOOL_CACHE || join(pixelmapperHome(), 'mcp-tools.json'),
    callTimeoutMs: intFromEnv(env.PIXELMAPPER_MCP_CALL_TIMEOUT_MS, DEFAULT_CALL_TIMEOUT_MS),
    helloTimeoutMs: 5_000,
    appWaitMs: intFromEnv(env.PIXELMAPPER_MCP_APP_WAIT_MS, DEFAULT_APP_WAIT_MS),
    skillsDir: env.PIXELMAPPER_SKILLS_DIR || defaultSkillsDir(),
    maxOutputChars: intFromEnv(env.PIXELMAPPER_MCP_MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_CHARS),
  };
}

/** True when `origin` may connect as `app`. */
export function isOriginAllowed(config: Pick<BridgeConfig, 'allowedOrigins'>, origin: string | undefined): boolean {
  if (config.allowedOrigins === '*') return true;
  return !!origin && config.allowedOrigins.includes(origin);
}
