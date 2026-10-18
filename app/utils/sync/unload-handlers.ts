import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { flushOutboxWrites } from '~/utils/persistence/outbox-writer';
import { isOnline } from '~/utils/sync/connectivity';
import type { ProjectSession } from '~/utils/sync/project-session';

/**
 * Page-lifecycle persistence of an open project (ADR 0004 §3.1, D8, D9):
 * - `visibilitychange → hidden` and `beforeunload` write the outbox rows and
 *   the working snapshot (the durable record for the next open);
 * - `beforeunload` additionally sends a best-effort keepalive push of the
 *   in-memory queue (and a final server snapshot when nothing is queued), only
 *   for synced cloud sessions without backlog. Correctness never depends on
 *   these requests: the outbox is pushed by the next session's sync.
 */

export interface UnloadOptions {
  projectId: string;
  session: ProjectSession;
  /** Cached access token (keepalive needs it synchronously). */
  token(): string;
  /** `<supabase>/functions/v1` base URL. */
  functionsUrl: string;
  /** Unsent persist-queue entries. */
  queued(): Array<{ type: string; payload: unknown; changeId?: string }>;
  /** Engine state differs from the last server snapshot. */
  isDirty(): boolean;
  buildSnapshot(): ProjectSnapshot;
  lastSequence(): number;
  /** Cancel snapshot timers before the page goes away. */
  beforeLeave(): void;
}

/** Fire-and-forget keepalive POST (64 KB body cap; failures only logged). */
function keepalive(url: string, token: string, body: unknown): void {
  fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(err => console.warn('[sync] keepalive request failed:', err));
}

/** Install the handlers; returns a disposer (project switch). */
export function installUnloadHandlers(opts: UnloadOptions): () => void {
  if (typeof window === 'undefined') return () => {};
  const { session } = opts;

  const onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    void flushOutboxWrites();
    void session.writer.flush();
  };

  const onUnload = () => {
    opts.beforeLeave();
    void flushOutboxWrites();
    void session.writer.flush();
    const engine = session.engine;
    const token = opts.token();
    // Offline, unbound or with a backlog (needs a rebase first): nothing is sent.
    if (!engine || engine.hasBacklog() || !token || !isOnline.value) return;
    const pending = opts.queued();
    if (pending.length > 0) {
      keepalive(`${opts.functionsUrl}/push-change`, token, {
        projectId: opts.projectId,
        changes: pending.map(e => ({ commandType: e.type, payload: e.payload, changeId: e.changeId })),
      });
      // A snapshot now would carry a sequence number before these changes.
      return;
    }
    if (!opts.isDirty()) return;
    try {
      keepalive(`${opts.functionsUrl}/save-snapshot`, token, {
        projectId: opts.projectId,
        snapshot: opts.buildSnapshot(),
        sequenceNumber: opts.lastSequence(),
      });
    }
    catch (err) {
      console.warn('[sync] unload snapshot failed:', err);
    }
  };

  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('beforeunload', onUnload);
  return () => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('beforeunload', onUnload);
  };
}
