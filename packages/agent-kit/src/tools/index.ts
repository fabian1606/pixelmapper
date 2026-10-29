/**
 * Agent tool surface (ADR 0002 §5 minus `delegate` / `ask_user`; plan M3):
 * `inspect`, `operations`, `describe`, `apply`, `observe`.
 */
import { createApplyTool } from './apply';
import { createDescribeTool } from './describe';
import { createInspectTool } from './inspect';
import { createObserveTool } from './observe';
import { createOperationsTool } from './operations';
import type { ToolDefinition } from './types';

export * from './types';
export { DescribeInputSchema, GUIDE_PREFIX } from './describe';
export { summarizeApply } from './apply';
export { createApplyTool, createDescribeTool, createInspectTool, createObserveTool, createOperationsTool };

/** All tools in workflow order (inspect → operations/describe → apply → observe). */
export function createTools(): ToolDefinition[] {
  return [
    createInspectTool(),
    createOperationsTool(),
    createDescribeTool(),
    createApplyTool(),
    createObserveTool(),
  ];
}

/** Finds a tool by name. */
export function findTool(tools: readonly ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find(t => t.name === name);
}
