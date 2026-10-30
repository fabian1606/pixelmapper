/**
 * Shared helpers of the agent tools: input validation and MCP-friendly
 * result content (`text` for the model, `json` for exact values).
 */
import type { z } from 'zod';
import { toJsonSchema } from '../json-schema';
import type { ToolContent, ToolDescriptor, ToolOutput } from './types';

// ── Schemas ─────────────────────────────────────

/** JSON schema of a tool input (root forced to `type: "object"` as MCP requires). */
export function toolInputSchema(schema: z.ZodType): ToolDescriptor['inputSchema'] {
  const json = toJsonSchema(schema, 'input');
  // `$schema` is noise for MCP clients; drop it to keep tool lists small.
  const { $schema: _ignored, ...rest } = json;
  return { ...rest, type: 'object' };
}

// ── Validation ──────────────────────────────────

/** Parses `input`; on failure returns an `isError` output listing the issues. */
export function parseInput<T extends z.ZodType>(
  tool: string,
  schema: T,
  input: unknown,
): { ok: true; value: z.output<T> } | { ok: false; output: ToolOutput } {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map(i => `- ${i.path.length ? i.path.map(String).join('.') : '(input)'}: ${i.message}`)
    .join('\n');
  return { ok: false, output: errorOutput(`Invalid input for "${tool}":\n${issues}`) };
}

// ── Content ─────────────────────────────────────

/** Text content item. */
export function text(value: string): ToolContent {
  return { type: 'text', text: value };
}

/** JSON content item. */
export function json(value: unknown): ToolContent {
  return { type: 'json', json: value };
}

/** JSON longer than this (pretty-printed) is serialized without indentation. */
export const PRETTY_JSON_MAX_CHARS = 8_000;

/**
 * Serializes a value for a text item: indented when small, compact when
 * large (indentation alone can double the size of entity dumps, pushing
 * them over MCP client output caps).
 */
export function jsonText(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2) ?? 'null';
  return pretty.length <= PRETTY_JSON_MAX_CHARS ? pretty : JSON.stringify(value) ?? 'null';
}

/** Output with a text summary and the exact JSON value. */
export function textAndJson(summary: string, value: unknown, isError = false): ToolOutput {
  return { content: [text(summary), json(value)], ...(isError ? { isError: true } : {}) };
}

/** Domain error (the tool ran but the request failed). */
export function errorOutput(message: string): ToolOutput {
  return { content: [text(message)], isError: true };
}

/** Readable message of a thrown value. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
