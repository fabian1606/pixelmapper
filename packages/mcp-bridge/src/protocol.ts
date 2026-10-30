// ── MCP bridge wire protocol ────────────────────────────
//
// Types, constants and validation helpers for the WebSocket protocol between
// `pixelmapper-mcp` (hub / relay) and the Pixelmapper app. The normative
// description lives in `architecture/mcp-bridge-protocol.md`; keep both in sync.

/** Semver of the wire protocol. Bump major on breaking changes. */
export const PROTOCOL_VERSION = '1.0.0';

/** Version of this CLI, reported in the hub `hello`. */
export const BRIDGE_VERSION = '0.1.0';

/** Connection roles a client can claim in its `hello`. */
export type ClientRole = 'app' | 'relay';

/** A tool definition announced by the app (mirrors the MCP `Tool` shape). */
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
  annotations?: Record<string, unknown>;
}

/** One item of a tool result as sent by the app. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'json'; json: unknown }
  | { type: 'image'; data: string; mimeType: string };

/** Outcome of a successful round-trip (the tool may still report `isError`). */
export interface ToolCallOutcome {
  content: ToolContent[];
  isError?: boolean;
}

/** Metadata the app sends about itself. */
export interface AppInfo {
  name?: string;
  version?: string;
  platform?: string;
}

/** Metadata about an MCP client (Claude Code, Claude Desktop, …). */
export interface ClientInfo {
  name: string;
  version?: string;
}

/** Error codes (see protocol doc, "Error codes"). */
export type ErrorCode =
  | 'bad_message'
  | 'bad_hello'
  | 'protocol_mismatch'
  | 'unauthorized'
  | 'origin_rejected'
  | 'no_app'
  | 'app_disconnected'
  | 'timeout'
  | 'unknown_tool'
  | 'tool_failed';

/** WebSocket close codes used by the hub. */
export const CLOSE_CODES = {
  unauthorized: 4001,
  protocolMismatch: 4002,
  superseded: 4003,
  badHello: 4004,
  helloTimeout: 4005,
  goingAway: 1001,
} as const;

/**
 * Maximum WebSocket frame size (bytes) the hub accepts. A larger frame makes
 * the hub drop the socket, so senders check against it first and answer with
 * an explicit error instead (screenshots may be large, hence the headroom).
 */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** UTF-8 byte length of a serialized frame (cheap path for short strings). */
export function frameBytes(serialized: string): number {
  // A UTF-16 code unit encodes to at most 3 UTF-8 bytes.
  if (serialized.length * 3 <= MAX_FRAME_BYTES) return serialized.length;
  return new TextEncoder().encode(serialized).byteLength;
}

/** User-facing hint returned whenever no app is connected. */
export const NO_APP_MESSAGE =
  'Pixelmapper is not connected. Open Pixelmapper and enable Settings → External agents ' +
  '(pairing token: run `pixelmapper-mcp token`).';

/** Error carrying a protocol error code; thrown by backends for failed calls. */
export class BridgeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** A parsed inbound JSON frame: always an object with a string `type`. */
export type Frame = { type: string; [key: string]: unknown };

// ── Helpers ─────────────────────────────────────────────

/** Parses a raw text frame; returns `null` for anything that is not `{ type: string }`. */
export function parseFrame(raw: unknown): Frame | null {
  try {
    const text = typeof raw === 'string' ? raw : String(raw);
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof (value as Frame).type !== 'string') return null;
    return value as Frame;
  } catch {
    return null;
  }
}

/** Returns the major component of a semver string, or `null` if malformed. */
export function semverMajor(version: unknown): number | null {
  if (typeof version !== 'string') return null;
  const match = /^(\d+)\.\d+\.\d+/.exec(version);
  return match ? Number(match[1]) : null;
}

/** True when `version` is compatible with {@link PROTOCOL_VERSION} (same major). */
export function isCompatibleProtocol(version: unknown): boolean {
  const major = semverMajor(version);
  return major !== null && major === semverMajor(PROTOCOL_VERSION);
}

/** Tool names allowed by MCP clients (Claude requires this pattern). */
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Filters an untrusted tool list down to valid, uniquely named definitions.
 * Invalid entries are reported through `onInvalid` and dropped.
 */
export function sanitizeTools(
  value: unknown,
  onInvalid: (reason: string) => void = () => {},
): ToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ToolDefinition[] = [];
  for (const entry of value) {
    const tool = entry as Partial<ToolDefinition> | null;
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !TOOL_NAME_RE.test(tool.name)) {
      onInvalid(`invalid tool name: ${JSON.stringify((tool as { name?: unknown } | null)?.name)}`);
      continue;
    }
    const schema = tool.inputSchema as { type?: unknown } | undefined;
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      onInvalid(`tool "${tool.name}": inputSchema must be a JSON schema with type "object"`);
      continue;
    }
    if (seen.has(tool.name)) {
      onInvalid(`duplicate tool "${tool.name}"`);
      continue;
    }
    seen.add(tool.name);
    result.push({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: tool.inputSchema as ToolDefinition['inputSchema'],
      annotations: tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : undefined,
    });
  }
  return result;
}

/** Validates an app/hub `result` content array; unknown items become text. */
export function sanitizeContent(value: unknown): ToolContent[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ToolContent => {
    const c = item as Partial<ToolContent> & Record<string, unknown>;
    if (c?.type === 'text' && typeof c.text === 'string') return { type: 'text', text: c.text };
    if (c?.type === 'json') return { type: 'json', json: c.json };
    if (c?.type === 'image' && typeof c.data === 'string' && typeof c.mimeType === 'string') {
      return { type: 'image', data: c.data, mimeType: c.mimeType };
    }
    return { type: 'text', text: JSON.stringify(item) };
  });
}

/** Known error codes, used to sanitize codes received over the wire. */
const ERROR_CODES = new Set<ErrorCode>([
  'bad_message', 'bad_hello', 'protocol_mismatch', 'unauthorized', 'origin_rejected',
  'no_app', 'app_disconnected', 'timeout', 'unknown_tool', 'tool_failed',
]);

/** Maps an arbitrary wire code to a known {@link ErrorCode} (default `tool_failed`). */
export function toErrorCode(value: unknown): ErrorCode {
  return ERROR_CODES.has(value as ErrorCode) ? (value as ErrorCode) : 'tool_failed';
}
