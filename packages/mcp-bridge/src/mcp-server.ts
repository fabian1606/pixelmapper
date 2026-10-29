// ── MCP server (stdio side) ─────────────────────────────
//
// Exposes the app's dynamic tool list and the skill prompts to the MCP client
// (Claude Code / Claude Desktop) and forwards tool calls to the backend.
// Uses the low-level SDK `Server` because tool schemas arrive as JSON Schema
// at runtime (the high-level `McpServer` expects Zod shapes).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { BackendState, ToolBackend } from './backend';
import { logWarn } from './log';
import { loadPrompts, renderPrompt } from './prompts';
import { BRIDGE_VERSION, BridgeError, NO_APP_MESSAGE } from './protocol';
import type { ToolCallOutcome, ToolContent } from './protocol';
import { STATUS_TOOL_NAME, ToolCatalog } from './tool-catalog';

/** Dependencies of the MCP server. */
export interface McpServerOptions {
  backend: ToolBackend;
  catalog: ToolCatalog;
  /** Directory scanned for prompts (`**\/prompts/*.md`). */
  skillsDir: string;
}

/** Instructions shown to the model on connect. */
const INSTRUCTIONS =
  'Pixelmapper is a DMX/pixel lighting controller. These tools run inside the open Pixelmapper app. ' +
  'Start with `inspect` (selector "project") and `operations`, read details with `describe`, change things ' +
  'with `apply` (use dryRun first for large batches) and verify with `observe`. If a tool reports that the ' +
  'app is not connected, ask the user to open Pixelmapper and enable Settings → External agents.';

/** Normalizes the MCP client name for actor ids (`agent:mcp:<client>`). */
export function normalizeClientName(name: string | undefined): string {
  const normalized = (name ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

/** Converts app content items into MCP content blocks. */
export function toMcpContent(content: ToolContent[]): CallToolResult['content'] {
  return content.map((item) => {
    if (item.type === 'json') return { type: 'text' as const, text: JSON.stringify(item.json, null, 2) };
    if (item.type === 'image') return { type: 'image' as const, data: item.data, mimeType: item.mimeType };
    return { type: 'text' as const, text: item.text };
  });
}

/** Renders the status tool's report. */
function statusText(state: BackendState, client: string): string {
  const lines = [
    `bridge: pixelmapper-mcp ${BRIDGE_VERSION} (${state.mode})`,
    `mcp client: ${client}`,
    `app: ${state.appConnected ? 'connected' : 'not connected'}`,
  ];
  if (state.app) lines.push(`app version: ${state.app.name ?? 'pixelmapper'} ${state.app.version ?? '?'} (${state.app.platform ?? '?'})`);
  if (state.appConnected) lines.push(`tools: ${state.tools.map((t) => t.name).join(', ') || '(none)'}`);
  else lines.push(NO_APP_MESSAGE);
  return lines.join('\n');
}

/** Creates the MCP server; call `server.connect(transport)` afterwards. */
export function createMcpServer({ backend, catalog, skillsDir }: McpServerOptions): Server {
  const server = new Server(
    { name: 'pixelmapper', version: BRIDGE_VERSION },
    {
      capabilities: { tools: { listChanged: true }, prompts: { listChanged: false } },
      instructions: INSTRUCTIONS,
    },
  );
  const clientName = () => normalizeClientName(server.getClientVersion()?.name);

  // ── Tool list + change notifications ──────────────────
  let initialized = false;
  let lastSignature = JSON.stringify(catalog.list(backend.getState()));
  server.oninitialized = () => {
    initialized = true;
  };
  backend.onChange(() => {
    const state = backend.getState();
    catalog.update(state);
    const signature = JSON.stringify(catalog.list(state));
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (initialized) {
      server.sendToolListChanged().catch((error) => logWarn('cannot send tools/list_changed', error));
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.list(backend.getState()),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const { name, arguments: input } = request.params;
    if (name === STATUS_TOOL_NAME) {
      return { content: [{ type: 'text', text: statusText(backend.getState(), clientName()) }] };
    }
    try {
      const outcome: ToolCallOutcome = await backend.call({
        tool: name,
        input: input ?? {},
        client: clientName(),
        signal: extra.signal,
      });
      return { content: toMcpContent(outcome.content), isError: outcome.isError || undefined };
    } catch (error) {
      // Tool-level errors are returned as results so the model can react.
      const message = error instanceof BridgeError ? `${error.code}: ${error.message}` : String(error);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  // ── Prompts ───────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: loadPrompts(skillsDir).map(({ name, description, arguments: args }) => ({
      name,
      description,
      arguments: args,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = loadPrompts(skillsDir).find((p) => p.name === request.params.name);
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${request.params.name}"`);
    let text: string;
    try {
      text = renderPrompt(prompt, request.params.arguments ?? {});
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, (error as Error).message);
    }
    return {
      description: prompt.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
    };
  });

  return server;
}
