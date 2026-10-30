/**
 * Agent host contract (ADR 0002 §5, plan M3).
 *
 * The tool surface (`inspect`, `operations`, `describe`, `apply`,
 * `observe`) is implemented once against this interface. The app provides
 * an implementation (`app/utils/agents/host.ts`); headless hosts and the
 * MCP bridge reuse the same tools.
 */
import { z } from 'zod';
import type { Actor } from './actor';
import type { ApplyRequest, ApplyResult } from './apply';
import type { ObserveReport, ObserveRequest } from './observe';
import type { OperationDescription, OperationQuery, OperationSummary } from './operation';
import type { ScreenshotRequest, ScreenshotResult } from './screenshot';

// ── Inspect ─────────────────────────────────────

/**
 * What to inspect:
 * - `'project'`: compact project digest;
 * - `'selection'`: current selection;
 * - `'events'`: recent event-log entries;
 * - `{ op, input }`: run a query operation;
 * - an array of entity ids (`fixture:12`, `modifier:abc`, or plain fixture ids).
 */
export type InspectSelector = 'project' | 'selection' | 'events' | { op: string; input?: unknown } | string[];

/** Request of the `inspect` tool. */
export interface InspectRequest {
  selector: InspectSelector;
  detail?: 'summary' | 'full';
  /** `'events'`: max entries (default 50). */
  limit?: number;
  /** `'events'`: filter by kind prefix, actor or cursor (`sinceId`). */
  filter?: { kind?: string; actor?: string; sinceId?: number };
}

/** Zod schema of the inspect request. */
export const InspectRequestSchema = z.object({
  selector: z.union([
    z.literal('project'),
    z.literal('selection'),
    z.literal('events'),
    z.object({ op: z.string(), input: z.unknown().optional() }),
    z.array(z.string()),
  ]).describe('"project", "selection", "events", { op, input } for a query operation, or entity ids.'),
  detail: z.enum(['summary', 'full']).optional(),
  limit: z.number().int().positive().optional().describe('"events": max entries (newest N, default 50).'),
  filter: z.object({
    kind: z.string().optional().describe('Kind or kind prefix, e.g. "command", "operation", "engine".'),
    actor: z.string().optional().describe('Exact actor, e.g. "user" or "agent:mcp:claude-code".'),
    sinceId: z.number().int().nonnegative().optional().describe('Only events newer than this id (cursor).'),
  }).optional().describe('"events": filter.'),
});

/** Result of `inspect`: JSON value plus optional compact text. */
export interface InspectResult {
  value: unknown;
  text?: string;
}

// ── Guides ──────────────────────────────────────

/** A guide topic (`guide:plugin-authoring`, …) served by `describe`. */
export interface GuideSummary {
  id: string;
  title: string;
}

/** Guide provider. */
export interface GuideProvider {
  list(): GuideSummary[];
  /** Markdown of a guide, or `null` when unknown. */
  get(id: string): string | null | Promise<string | null>;
}

// ── Host ────────────────────────────────────────

/** Per-call context of host methods that change or capture state. */
export interface HostCallContext {
  /** Actor the change is attributed to (default `user`). */
  actor?: Actor;
  /** Aborted when the caller cancels. */
  signal?: AbortSignal;
}

/** Everything the agent tools need from a host. */
export interface AgentHost {
  listOperations(query?: OperationQuery): OperationSummary[];
  describeOperation(id: string): OperationDescription | null;
  inspect(request: InspectRequest): Promise<InspectResult>;
  /** Runs a transaction attributed to `ctx.actor`. */
  apply(request: ApplyRequest, ctx?: HostCallContext): Promise<ApplyResult>;
  /** Observes output; rejects with a readable error when observation is unavailable. */
  observe(request: ObserveRequest, ctx?: HostCallContext): Promise<ObserveReport>;
  /**
   * Renders a screenshot (optional, ADR 0002 §5 opt-in tool). Rejects with
   * a readable error when the requested view is unavailable.
   */
  screenshot?(request: ScreenshotRequest, ctx?: HostCallContext): Promise<ScreenshotResult>;
  guides: GuideProvider;
}
