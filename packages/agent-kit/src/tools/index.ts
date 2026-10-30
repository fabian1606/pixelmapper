/**
 * Agent tool surface (ADR 0002 §5 minus `delegate` / `ask_user`; plan M3):
 * `inspect`, `operations`, `describe`, `apply`, `observe`, plus the opt-in
 * `screenshot` tool.
 */
import { createApplyTool } from './apply';
import { createDescribeTool } from './describe';
import { createInspectTool } from './inspect';
import { createObserveTool } from './observe';
import { createOperationsTool } from './operations';
import { createScreenshotTool } from './screenshot';
import type { ToolDefinition } from './types';

export * from './types';
export { DescribeInputSchema, GUIDE_PREFIX } from './describe';
export { summarizeApply } from './apply';
export { SCREENSHOT_UNSUPPORTED } from './screenshot';
export { createApplyTool, createDescribeTool, createInspectTool, createObserveTool, createOperationsTool, createScreenshotTool };

/** Options of {@link createTools}. */
export interface CreateToolsOptions {
  /** Adds the opt-in `screenshot` tool (ADR 0002 §5); the host should implement `screenshot`. */
  screenshot?: boolean;
}

/** All tools in workflow order (inspect → operations/describe → apply → observe [→ screenshot]). */
export function createTools(opts: CreateToolsOptions = {}): ToolDefinition[] {
  return [
    createInspectTool(),
    createOperationsTool(),
    createDescribeTool(),
    createApplyTool(),
    createObserveTool(),
    ...(opts.screenshot ? [createScreenshotTool()] : []),
  ];
}

/** Finds a tool by name. */
export function findTool(tools: readonly ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find(t => t.name === name);
}
