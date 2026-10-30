/**
 * Shared helpers of the agent tools: input validation and MCP-friendly
 * result content (`text` for the model, `json` for exact values).
 */
import { z } from 'zod';
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

/** True for plain objects (not arrays / null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Renames alias keys to their canonical key when the canonical key is
 * absent (`{ selector: "x" }` → `{ id: "x" }` for `describe`). Other inputs
 * are returned as is.
 */
export function applyKeyAliases(input: unknown, aliases: Record<string, string>): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = { ...input };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in out && !(canonical in out)) {
      out[canonical] = out[alias];
      delete out[alias];
    }
  }
  return out;
}

/** "Expected keys: id (required), detail" of an object schema; empty for other schemas. */
function expectedKeysHint(schema: z.ZodType, input: unknown): string {
  if (!(schema instanceof z.ZodObject)) return '';
  const shape = schema.shape as Record<string, z.ZodType>;
  const keys = Object.entries(shape).map(([k, v]) => (v.safeParse(undefined).success ? k : `${k} (required)`));
  const unknown = isRecord(input) ? Object.keys(input).filter(k => !(k in shape)) : [];
  const head = unknown.length ? `Unknown key(s): ${unknown.join(', ')}. ` : '';
  return `\n${head}Expected keys: ${keys.join(', ')}.`;
}

/**
 * Parses `input` (after renaming `aliases`); on failure returns an
 * `isError` output listing the issues, unknown keys and the expected keys.
 */
export function parseInput<T extends z.ZodType>(
  tool: string,
  schema: T,
  input: unknown,
  aliases: Record<string, string> = {},
): { ok: true; value: z.output<T> } | { ok: false; output: ToolOutput } {
  const raw = applyKeyAliases(input ?? {}, aliases);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map(i => `- ${i.path.length ? i.path.map(String).join('.') : '(input)'}: ${i.message}`)
    .join('\n');
  return { ok: false, output: errorOutput(`Invalid input for "${tool}":\n${issues}${expectedKeysHint(schema, raw)}`) };
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
