// ── Public surface of @pixelmapper/mcp-bridge ───────────
//
// The app-side client only needs the protocol types/constants; the rest is
// exported for tests and embedding.

export * from './protocol';
export type { BackendState, CallRequest, ToolBackend } from './backend';
export { loadConfig, DEFAULT_PORT, DEFAULT_ALLOWED_ORIGINS } from './config';
export type { BridgeConfig } from './config';
export { Hub } from './hub';
export { RelayClient } from './relay-client';
export { BridgeCoordinator } from './coordinator';
export { createMcpServer, normalizeClientName, toMcpContent } from './mcp-server';
export { ToolCatalog, FALLBACK_TOOLS, STATUS_TOOL, STATUS_TOOL_NAME } from './tool-catalog';
export { loadPrompts, parsePromptFile, renderPrompt } from './prompts';
export { loadOrCreateToken, tokensEqual, generateToken } from './token';
