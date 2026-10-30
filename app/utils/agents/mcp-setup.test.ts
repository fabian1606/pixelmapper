import { describe, expect, it } from 'vitest';
import { CLI_PATH_PLACEHOLDER, claudeCodeCommand, claudeDesktopConfig } from './mcp-setup';

describe('MCP setup snippets', () => {
  it('uses the real CLI path when known', () => {
    expect(claudeCodeCommand('/x/packages/mcp-bridge/src/cli.ts')).toBe('claude mcp add pixelmapper -- bun run /x/packages/mcp-bridge/src/cli.ts');
    expect(JSON.parse(claudeDesktopConfig('/x/cli.ts'))).toEqual({ mcpServers: { pixelmapper: { command: 'bun', args: ['run', '/x/cli.ts'] } } });
  });

  it('falls back to a placeholder in the browser', () => {
    expect(claudeCodeCommand(null)).toContain(CLI_PATH_PLACEHOLDER);
    expect(claudeDesktopConfig(null)).toContain(CLI_PATH_PLACEHOLDER);
  });
});
