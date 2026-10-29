/**
 * Agent tool contract (ADR 0002 §5, plan M3).
 *
 * A tool is host-agnostic: it receives an `AgentHost` plus a per-call
 * context (actor, abort signal) and returns MCP-friendly content. The same
 * definitions are announced to `pixelmapper-mcp` (wire shape: `name`,
 * `description`, `inputSchema`, `annotations`) and later reused by the
 * in-app copilot (ADR D16).
 */
import type { Actor } from '../actor';
import type { AgentHost } from '../host';

// ── Content ─────────────────────────────────────

/** One item of a tool result (mirrors the bridge wire `Content`). */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'json'; json: unknown }
  | { type: 'image'; data: string; mimeType: string };

/** Result of a tool run. `isError` = the tool ran but reports a domain failure. */
export interface ToolOutput {
  content: ToolContent[];
  isError?: boolean;
}

// ── Context ─────────────────────────────────────

/** Per-call context. */
export interface ToolContext {
  /** Who runs the tool (e.g. `agent:mcp:claude-code`); mutations are attributed to it. */
  actor: Actor;
  /** Aborted when the caller cancels (bridge `cancel`). */
  signal?: AbortSignal;
}

// ── Definition ──────────────────────────────────

/** JSON-serialisable part of a tool (what the bridge announces). */
export interface ToolDescriptor {
  /** `^[a-zA-Z0-9_-]{1,64}$`, unique. */
  name: string;
  /** Written for an AI agent: what the tool does and how it fits the workflow. */
  description: string;
  /** JSON schema of the input, root `type: "object"`. */
  inputSchema: { type: 'object'; [key: string]: unknown };
  /** MCP tool annotations (`readOnlyHint`, `destructiveHint`, …). */
  annotations?: Record<string, unknown>;
}

/** A tool: descriptor plus implementation. */
export interface ToolDefinition extends ToolDescriptor {
  /** Runs the tool. Throwing = the tool could not run (bridge `tool_failed`). */
  run(host: AgentHost, input: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

/** Strips `run` (wire / MCP `tools/list` shape). */
export function toolDescriptor(tool: ToolDefinition): ToolDescriptor {
  const { name, description, inputSchema, annotations } = tool;
  return { name, description, inputSchema, ...(annotations ? { annotations } : {}) };
}
