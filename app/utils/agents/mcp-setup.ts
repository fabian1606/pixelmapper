/**
 * Setup snippets for Settings → MCP Server and the desktop MCP menu: how to
 * register `pixelmapper-mcp` with Claude Code and Claude Desktop.
 */

/** What the platform knows about the local MCP setup (`#platform` `getMcpSetupInfo`). */
export interface McpSetupInfo {
  /** Path of the pairing token file, if known (desktop only). */
  tokenFile: string | null;
  /** Token from that file, if the CLI has created it (desktop only). */
  token: string | null;
  /** Absolute path of `packages/mcp-bridge/src/cli.ts`, if known (desktop only). */
  cliPath: string | null;
}

/** Setup info when the platform cannot look at the local machine (browser). */
export const UNKNOWN_MCP_SETUP: McpSetupInfo = Object.freeze({ tokenFile: null, token: null, cliPath: null });

/** Placeholder shown when the CLI path is unknown. */
export const CLI_PATH_PLACEHOLDER = '<repo>/packages/mcp-bridge/src/cli.ts';

/** Shell command that registers the server with Claude Code. */
export function claudeCodeCommand(cliPath: string | null): string {
  return `claude mcp add pixelmapper -- bun run ${cliPath ?? CLI_PATH_PLACEHOLDER}`;
}

/** `mcpServers` entry for Claude Desktop's `claude_desktop_config.json`. */
export function claudeDesktopConfig(cliPath: string | null): string {
  const config = { mcpServers: { pixelmapper: { command: 'bun', args: ['run', cliPath ?? CLI_PATH_PLACEHOLDER] } } };
  return JSON.stringify(config, null, 2);
}
