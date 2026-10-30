// ── Tool output budget ──────────────────────────────────
//
// MCP clients cap the size of a tool result (Claude Code: `MAX_MCP_OUTPUT_TOKENS`,
// 25 000 tokens by default) and cut anything larger without telling the model
// where. A large `inspect` with `detail: "full"` (e.g. LED tubes with all
// pixels) hit that cap around 64 KB of pretty-printed JSON and arrived as a
// JSON document cut mid-way. The bridge therefore renders content itself
// within an explicit budget: large JSON is serialized compactly, and when the
// result still does not fit it is cut here with a clearly marked notice that
// tells the model how much is missing and how to narrow the request.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { ToolContent } from './protocol';

/**
 * Default character budget of all text blocks of one tool result. Chosen well
 * below Claude Code's default 25 000-token cap even for dense JSON
 * (~2 characters per token), so the bridge, not the client, decides the cut.
 */
export const DEFAULT_MAX_OUTPUT_CHARS = 40_000;

/** JSON whose pretty form is longer than this is serialized without indentation. */
export const PRETTY_JSON_MAX_CHARS = 8_000;

/** Characters reserved for the truncation notice when cutting. */
const NOTICE_RESERVE = 400;

/** Serializes a JSON value: pretty when small, compact when large. */
export function renderJson(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2) ?? 'null';
  if (pretty.length <= PRETTY_JSON_MAX_CHARS) return pretty;
  return JSON.stringify(value) ?? 'null';
}

/** Builds the notice appended after a cut result. */
export function truncationNotice(shownChars: number, totalChars: number, maxChars: number): string {
  return (
    `[output truncated: showed ${shownChars} of ${totalChars} characters (limit ${maxChars}). ` +
    'The JSON/text above is INCOMPLETE and ends mid-value; do not parse it as a whole. ' +
    'Narrow the request to get the rest: select fewer entities (e.g. one fixture id at a time), ' +
    'use detail "summary", or run a query operation via { op, input }.]'
  );
}

/**
 * Converts app content items into MCP content blocks within `maxChars`.
 * Text blocks are filled in order; the first block that does not fit is cut
 * (marked with `…`), later text blocks are dropped and a notice is appended.
 * Images do not count toward the budget (clients size them separately).
 */
export function toMcpContent(
  content: ToolContent[],
  maxChars: number = DEFAULT_MAX_OUTPUT_CHARS,
): CallToolResult['content'] {
  // Render every item once so sizes are known up front.
  const rendered = content.map((item) => {
    if (item.type === 'image') return { type: 'image' as const, data: item.data, mimeType: item.mimeType };
    return { type: 'text' as const, text: item.type === 'json' ? renderJson(item.json) : item.text };
  });
  const totalChars = rendered.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0);
  if (totalChars <= maxChars) return rendered;

  // Over budget: keep text up to the budget (minus room for the notice).
  const budget = Math.max(0, maxChars - NOTICE_RESERVE);
  const out: CallToolResult['content'] = [];
  let used = 0;
  for (const block of rendered) {
    if (block.type !== 'text') {
      out.push(block);
      continue;
    }
    const remaining = budget - used;
    if (remaining <= 0) continue;
    if (block.text.length <= remaining) {
      out.push(block);
      used += block.text.length;
      continue;
    }
    out.push({ type: 'text', text: `${block.text.slice(0, remaining)}…` });
    used += remaining;
  }
  out.push({ type: 'text', text: truncationNotice(used, totalChars, maxChars) });
  return out;
}
