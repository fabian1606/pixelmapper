import { shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { getSnapshotPreview } from '~/utils/sync/remote-api-snapshot-preview';
import type { SnapshotHighlights } from '~/utils/sync/version-preview/highlight-types';
import { buildPreviewModel, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * Loading of version-history hover previews, one state per snapshot.
 * Models are cached in memory per (projectId, snapshotId) — snapshots are
 * immutable — so hovering again (also offline) is instant. A load runs only
 * while its entry is shown: `cancel` aborts the request (AbortSignal) and
 * resets the state, so a quick pass over the list costs nothing.
 * Highlights (what changed since the diff base, migration 015) are cached
 * with the model together with the `compareToId` they were computed for; a
 * different base (list paged further) reloads.
 * Framework-free apart from Vue refs; dependencies are injected.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface VersionPreviewDeps {
  projectId: string;
  /** Supabase client; null when unavailable. */
  client: () => RemoteClient | null;
  online: Readonly<Ref<boolean>>;
}

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export interface PreviewState {
  status: PreviewStatus;
  model: PreviewModel | null;
  /** What changed since the previous version; null from older servers / before load. */
  highlights: SnapshotHighlights | null;
  error: string | null;
}

/** Cached result of one snapshot. */
interface CachedPreview {
  model: PreviewModel;
  highlights: SnapshotHighlights | null;
  /** Diff base the highlights were computed for (null = server-picked neighbour). */
  compareToId: string | null;
}

/** State without data. */
const empty = (status: PreviewStatus, error: string | null = null): PreviewState => ({ status, model: null, highlights: null, error });

// ── Cache ────────────────────────────────────────────────────────────────────

/** Max cached models (oldest dropped first). */
const CACHE_LIMIT = 100;
const cache = new Map<string, CachedPreview>();

const cacheKey = (projectId: string, snapshotId: string) => `${projectId}:${snapshotId}`;

function remember(key: string, entry: CachedPreview): void {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** Test helper / sign-out: drop all cached previews. */
export function clearVersionPreviewCache(): void {
  cache.clear();
}

// ── Controller ───────────────────────────────────────────────────────────────

export function createVersionPreview(deps: VersionPreviewDeps) {
  const states = new Map<string, ShallowRef<PreviewState>>();
  const inFlight = new Map<string, { promise: Promise<void>; abort: AbortController }>();

  /** Reactive state of one snapshot (cache-aware). */
  function state(snapshotId: string): Readonly<ShallowRef<PreviewState>> {
    let s = states.get(snapshotId);
    if (!s) {
      const hit = cache.get(cacheKey(deps.projectId, snapshotId));
      s = shallowRef<PreviewState>(hit
        ? { status: 'ready', model: hit.model, highlights: hit.highlights, error: null }
        : empty('idle'));
      states.set(snapshotId, s);
    }
    return s;
  }

  /**
   * Loads the preview of `snapshotId` compared with `compareToId` (next older
   * list entry; null → server picks the neighbour); no-op when ready for that
   * base or loading.
   */
  function load(snapshotId: string, compareToId: string | null = null): Promise<void> {
    const s = state(snapshotId) as ShallowRef<PreviewState>;
    const key = cacheKey(deps.projectId, snapshotId);
    if (s.value.status === 'ready' && (cache.get(key)?.compareToId ?? null) === compareToId) return Promise.resolve();
    const running = inFlight.get(snapshotId);
    if (running) return running.promise;

    const client = deps.client();
    if (!deps.online.value || !client) {
      // Offline: an older cached result (other diff base) is still better than nothing.
      if (s.value.status !== 'ready') s.value = empty('offline');
      return Promise.resolve();
    }
    const stale = s.value.status === 'ready' ? s.value : null;
    s.value = stale ?? empty('loading');
    const abort = new AbortController();
    const promise = (async () => {
      try {
        const res = await getSnapshotPreview(client, { projectId: deps.projectId, snapshotId, compareToId }, abort.signal);
        if (abort.signal.aborted) return;
        if (res.ok) {
          const model = buildPreviewModel(res.data.layout);
          const highlights = res.data.highlights;
          remember(key, { model, highlights, compareToId });
          s.value = { status: 'ready', model, highlights, error: null };
        }
        else if (stale) {
          // Keep the result for the old base rather than replacing it with an error.
          if (res.error.kind !== 'aborted') console.warn('[version-preview] reload failed:', res.error.message);
        }
        else if (res.error.kind === 'network') {
          s.value = empty('offline');
        }
        else if (res.error.kind !== 'aborted') {
          console.warn('[version-preview] load failed:', res.error.message);
          s.value = empty('error', 'Preview unavailable.');
        }
      }
      catch (err) {
        console.error('[version-preview] load failed:', err);
        if (!stale) s.value = empty('error', 'Preview unavailable.');
      }
      finally {
        if (inFlight.get(snapshotId)?.abort === abort) inFlight.delete(snapshotId);
      }
    })();
    inFlight.set(snapshotId, { promise, abort });
    return promise;
  }

  /** Aborts a pending load of `snapshotId` (pointer left); the state goes back to idle. */
  function cancel(snapshotId: string): void {
    const running = inFlight.get(snapshotId);
    if (!running) return;
    running.abort.abort();
    inFlight.delete(snapshotId);
    const s = states.get(snapshotId);
    if (s && s.value.status === 'loading') s.value = empty('idle');
  }

  /** Aborts every pending load (popover closed / project switched). */
  function cancelAll(): void {
    for (const id of [...inFlight.keys()]) cancel(id);
  }

  return { state, load, cancel, cancelAll };
}

export type VersionPreview = ReturnType<typeof createVersionPreview>;
