// ── Tool catalog: live, last-known, built-in ────────────
//
// MCP clients usually fetch `tools/list` once at startup, often before the
// app is connected. This module decides which list to expose:
// live app tools → last-known (memory, then disk cache) → built-in fallback.
// The local `pixelmapper_status` tool is always appended.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BackendState } from './backend';
import { logWarn } from './log';
import { sanitizeTools } from './protocol';
import type { ToolDefinition } from './protocol';

/** Name of the tool answered by the CLI itself. */
export const STATUS_TOOL_NAME = 'pixelmapper_status';

/** Local status tool definition (always listed). */
export const STATUS_TOOL: ToolDefinition = {
  name: STATUS_TOOL_NAME,
  description:
    'Report whether the Pixelmapper app is connected to this MCP bridge, which app version and how many tools ' +
    'it exposes. Call it first when another Pixelmapper tool reports that the app is not connected.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

/** Built-in placeholders for ADR 0002 §5 (minus delegate/ask_user) until the app announces real schemas. */
export const FALLBACK_TOOLS: ToolDefinition[] = [
  ['inspect', 'Read project state: project digest, selection, entities or a query operation.'],
  ['operations', 'List available Pixelmapper operations (ids + one-line descriptions).'],
  ['describe', 'Full description, JSON schema and examples of an operation or guide topic.'],
  ['apply', 'Apply a batch of mutation operations as one undoable step (supports dryRun).'],
  ['observe', 'Render targets live or as a headless preview and return a compact text report.'],
].map(([name, description]) => ({
  name: name!,
  description: `${description} (Pixelmapper is not connected yet; the full schema appears once it is.)`,
  inputSchema: { type: 'object', additionalProperties: true },
}));

/** Tracks the best-known tool list and persists it to disk. */
export class ToolCatalog {
  private lastKnown: ToolDefinition[] | null = null;

  constructor(private readonly cacheFile: string | null) {
    this.lastKnown = this.readCache();
  }

  /** Records the live list (when an app is connected) and persists it if it changed. */
  update(state: BackendState): void {
    if (!state.appConnected) return;
    const changed = JSON.stringify(state.tools) !== JSON.stringify(this.lastKnown);
    this.lastKnown = state.tools;
    if (changed) this.writeCache(state.tools);
  }

  /** The list to expose over MCP for the given backend state. */
  list(state: BackendState): ToolDefinition[] {
    const appTools = state.appConnected ? state.tools : (this.lastKnown ?? FALLBACK_TOOLS);
    return [...appTools.filter((t) => t.name !== STATUS_TOOL_NAME), STATUS_TOOL];
  }

  /** Loads the cached list; missing or broken caches are ignored. */
  private readCache(): ToolDefinition[] | null {
    if (!this.cacheFile || !existsSync(this.cacheFile)) return null;
    try {
      const tools = sanitizeTools(JSON.parse(readFileSync(this.cacheFile, 'utf8')));
      return tools.length ? tools : null;
    } catch (error) {
      logWarn(`ignoring unreadable tool cache ${this.cacheFile}`, error);
      return null;
    }
  }

  /** Writes the cache; failures are logged, never fatal. */
  private writeCache(tools: ToolDefinition[]): void {
    if (!this.cacheFile) return;
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true, mode: 0o700 });
      writeFileSync(this.cacheFile, JSON.stringify(tools, null, 2));
    } catch (error) {
      logWarn(`cannot write tool cache ${this.cacheFile}`, error);
    }
  }
}
