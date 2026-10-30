// ── Logging ─────────────────────────────────────────────
//
// stdout is the MCP stdio channel, so every log line MUST go to stderr.
// `console.log` is never used in this package.

/** When true, info lines are suppressed (tests set `PIXELMAPPER_MCP_QUIET=1`). */
const quiet = (): boolean => process.env.PIXELMAPPER_MCP_QUIET === '1';

/** Informational line on stderr with the `[mcp]` tag. */
export function logInfo(message: string): void {
  if (!quiet()) process.stderr.write(`[mcp] ${message}\n`);
}

/** Warning on stderr (never suppressed). */
export function logWarn(message: string, error?: unknown): void {
  if (quiet()) return;
  console.warn(`[mcp] ${message}`, ...(error === undefined ? [] : [error]));
}
