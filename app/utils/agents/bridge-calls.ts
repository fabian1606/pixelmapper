/**
 * Executes hub `call` frames against the app's tool definitions (protocol
 * doc, "App ↔ hub messages"). Tracks in-flight calls so `cancel` can abort
 * them and suppress their late answers.
 */
import type { AgentHost, ToolDefinition } from '@pixelmapper/agent-kit';
import { agentActor } from '@pixelmapper/agent-kit';

// ── Helpers ─────────────────────────────────────

/** Characters allowed in the client part of the actor id. */
const CLIENT_NAME_RE = /[^a-zA-Z0-9._-]+/g;

/**
 * Turns the hub-reported MCP client name into a safe actor id fragment
 * (`Claude Code` → `Claude-Code`); falls back to `unknown`.
 */
export function sanitizeClientName(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const cleaned = value.trim().replace(CLIENT_NAME_RE, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || 'unknown';
}

/** Readable message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

// ── Runner ──────────────────────────────────────

/** Dependencies of the call runner. */
export interface CallRunnerOptions {
  /** Current tool list (looked up per call so registry changes apply). */
  tools: () => ToolDefinition[];
  /** Host the tools run against. */
  host: () => AgentHost;
  /** Sends a reply frame to the hub (dropped when the socket is gone). */
  send: (frame: Record<string, unknown>) => void;
  /** Reports the MCP client of each call (for the status line). */
  onClient?: (client: string) => void;
}

/** Runs calls, answers them, and handles cancellation. */
export class CallRunner {
  /** In-flight calls by hub call id. */
  private readonly inflight = new Map<string | number, AbortController>();

  constructor(private readonly options: CallRunnerOptions) {}

  /** Handles one `call` frame. Never throws; always answers unless cancelled. */
  async run(frame: Record<string, unknown>): Promise<void> {
    const id = frame.id as string | number;
    const name = frame.tool;
    const tool = this.options.tools().find((t) => t.name === name);
    if (!tool) {
      this.options.send({ type: 'error', id, code: 'unknown_tool', message: `Unknown tool "${String(name)}"` });
      return;
    }
    const client = sanitizeClientName(frame.client);
    this.options.onClient?.(client);
    const controller = new AbortController();
    this.inflight.set(id, controller);
    try {
      const output = await tool.run(this.options.host(), frame.input ?? {}, {
        actor: agentActor(`mcp:${client}`),
        signal: controller.signal,
      });
      // A cancelled call's late result is suppressed (the hub already gave up).
      if (!this.finish(id, controller)) return;
      this.options.send({
        type: 'result',
        id,
        content: output.content,
        ...(output.isError ? { isError: true } : {}),
      });
    } catch (error) {
      if (!this.finish(id, controller)) return;
      console.warn(`[agent-bridge] tool "${tool.name}" failed`, error);
      this.options.send({ type: 'error', id, code: 'tool_failed', message: errorMessage(error) });
    }
  }

  /** Aborts one call (hub `cancel`); its answer will not be sent. */
  cancel(id: unknown, reason = 'cancelled'): void {
    const controller = this.inflight.get(id as string | number);
    if (!controller) return;
    this.inflight.delete(id as string | number);
    controller.abort(new Error(`Call cancelled: ${reason}`));
  }

  /** Aborts every in-flight call (socket closed / client stopped). */
  cancelAll(reason: string): void {
    for (const id of [...this.inflight.keys()]) this.cancel(id, reason);
  }

  /** Removes a finished call; false when it was cancelled meanwhile. */
  private finish(id: string | number, controller: AbortController): boolean {
    if (this.inflight.get(id) !== controller || controller.signal.aborted) return false;
    this.inflight.delete(id);
    return true;
  }
}
