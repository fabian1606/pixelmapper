import { shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { getSnapshotPreview } from '~/utils/sync/remote-api-snapshot-preview';
import { buildPreviewModel, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * Loading of version-history hover previews, one state per snapshot.
 * Models are cached in memory per (projectId, snapshotId) — snapshots are
 * immutable — so hovering again (also offline) is instant. A load runs only
 * while its entry is shown: `cancel` aborts the request (AbortSignal) and
 * resets the state, so a quick pass over the list costs nothing.
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
  error: string | null;
}

// ── Cache ────────────────────────────────────────────────────────────────────

/** Max cached models (oldest dropped first). */
const CACHE_LIMIT = 100;
const cache = new Map<string, PreviewModel>();

const cacheKey = (projectId: string, snapshotId: string) => `${projectId}:${snapshotId}`;

function remember(key: string, model: PreviewModel): void {
  cache.delete(key);
  cache.set(key, model);
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
      const model = cache.get(cacheKey(deps.projectId, snapshotId)) ?? null;
      s = shallowRef<PreviewState>({ status: model ? 'ready' : 'idle', model, error: null });
      states.set(snapshotId, s);
    }
    return s;
  }

  /** Loads the preview of `snapshotId`; no-op when ready or loading. */
  function load(snapshotId: string): Promise<void> {
    const s = state(snapshotId) as ShallowRef<PreviewState>;
    if (s.value.status === 'ready') return Promise.resolve();
    const running = inFlight.get(snapshotId);
    if (running) return running.promise;

    const client = deps.client();
    if (!deps.online.value || !client) {
      s.value = { status: 'offline', model: null, error: null };
      return Promise.resolve();
    }
    s.value = { status: 'loading', model: null, error: null };
    const abort = new AbortController();
    const promise = (async () => {
      try {
        const res = await getSnapshotPreview(client, { projectId: deps.projectId, snapshotId }, abort.signal);
        if (abort.signal.aborted) return;
        if (res.ok) {
          const model = buildPreviewModel(res.data.layout);
          remember(cacheKey(deps.projectId, snapshotId), model);
          s.value = { status: 'ready', model, error: null };
        }
        else if (res.error.kind === 'network') {
          s.value = { status: 'offline', model: null, error: null };
        }
        else if (res.error.kind !== 'aborted') {
          console.warn('[version-preview] load failed:', res.error.message);
          s.value = { status: 'error', model: null, error: 'Preview unavailable.' };
        }
      }
      catch (err) {
        console.error('[version-preview] load failed:', err);
        s.value = { status: 'error', model: null, error: 'Preview unavailable.' };
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
    if (s && s.value.status === 'loading') s.value = { status: 'idle', model: null, error: null };
  }

  /** Aborts every pending load (popover closed / project switched). */
  function cancelAll(): void {
    for (const id of [...inFlight.keys()]) cancel(id);
  }

  return { state, load, cancel, cancelAll };
}

export type VersionPreview = ReturnType<typeof createVersionPreview>;
