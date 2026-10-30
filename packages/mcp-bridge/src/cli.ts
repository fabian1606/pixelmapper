#!/usr/bin/env bun
// ── pixelmapper-mcp CLI ─────────────────────────────────
//
//   pixelmapper-mcp            stdio MCP server (launched by Claude Code / Desktop)
//   pixelmapper-mcp token      print the pairing token (creates it if missing)
//   pixelmapper-mcp help       usage
//
// In server mode stdout carries MCP JSON-RPC; all logging goes to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config';
import { BridgeCoordinator } from './coordinator';
import { logInfo, logWarn } from './log';
import { createMcpServer, normalizeClientName } from './mcp-server';
import { loadOrCreateToken } from './token';
import { ToolCatalog } from './tool-catalog';

/** Usage text (printed to stdout only for `help`, never in server mode). */
const USAGE = `pixelmapper-mcp — MCP bridge to the running Pixelmapper app

Usage:
  pixelmapper-mcp          Run the stdio MCP server (for Claude Code / Claude Desktop)
  pixelmapper-mcp token    Print the pairing token for Settings → External agents

Environment:
  PIXELMAPPER_MCP_PORT              WebSocket port (default 7778)
  PIXELMAPPER_MCP_ORIGINS           Comma-separated allowed app origins, or *
  PIXELMAPPER_MCP_TOKEN_FILE        Token file (default ~/.pixelmapper/mcp-token)
  PIXELMAPPER_MCP_CALL_TIMEOUT_MS   Per-call timeout (default 60000)
  PIXELMAPPER_SKILLS_DIR            Prompt root (default <repo>/docs/ai/skills)
`;

/** Runs the stdio MCP server until stdin closes or a signal arrives. */
async function serve(): Promise<void> {
  const config = loadConfig();
  const token = loadOrCreateToken(config.tokenFile);
  const catalog = new ToolCatalog(config.toolCacheFile);

  // The coordinator needs the MCP client name for relay hellos; it is known
  // after MCP initialize, so resolve it lazily through the server.
  let server: ReturnType<typeof createMcpServer> | null = null;
  const backend = new BridgeCoordinator(config, token, () => ({
    name: normalizeClientName(server?.getClientVersion()?.name),
    version: server?.getClientVersion()?.version,
  }));
  server = createMcpServer({
    backend,
    catalog,
    skillsDir: config.skillsDir,
    maxOutputChars: config.maxOutputChars,
  });

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo(`shutting down (${reason})`);
    await backend.close().catch((error) => logWarn('error while closing bridge', error));
    await server?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.stdin.on('end', () => void shutdown('stdin closed'));

  await server.connect(new StdioServerTransport());
  // Start the bridge after the MCP transport, so a slow election never delays initialize.
  await backend.start();
  logInfo(`ready (skills: ${config.skillsDir})`);
}

/** Entry point: dispatch subcommands. */
async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'serve';
  switch (command) {
    case 'serve':
      await serve();
      return;
    case 'token': {
      const config = loadConfig();
      process.stdout.write(`${loadOrCreateToken(config.tokenFile)}\n`);
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error('[mcp] fatal', error);
  process.exit(1);
});
