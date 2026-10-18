import { shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { getSnapshotDetails } from '~/utils/sync/remote-api-snapshot-details';
import { buildVersionDetailsView, type VersionDetailsView } from '~/utils/sync/version-details-view';
import type { DiffOptions } from '~/utils/sync/version-diff';

/**
 * Lazy loading of version-history details ("what changed"), one state per
 * snapshot. Loaded views are cached per (projectId, snapshotId) in memory
 * (they never change: both snapshots and the log between them are
 * immutable), so re-expanding — also offline — shows them instantly.
 * Framework-free apart from Vue refs; dependencies are injected.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface VersionDetailsDeps {
  projectId: string;
  /** Supabase client; null when unavailable. */
  client: () => RemoteClient | null;
  online: Readonly<Ref<boolean>>;
  /** Name hooks for the diff (modifier names from plugin manifests). */
  diffOptions?: () => DiffOptions;
}

/** `offline`: not cached and no connection. */
export type DetailsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export interface DetailsState {
  status: DetailsStatus;
  view: VersionDetailsView | null;
  error: string | null;
}

// ── Cache ────────────────────────────────────────────────────────────────────

/** Max cached views (oldest dropped first). */
const CACHE_LIMIT = 100;
const cache = new Map<string, VersionDetailsView>();

const cacheKey = (projectId: string, snapshotId: string) => `${projectId}:${snapshotId}`;

/** Stores a view, evicting the oldest entry beyond the limit. */
function remember(key: string, view: VersionDetailsView): void {
  cache.delete(key);
  cache.set(key, view);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** Test helper / sign-out: drop all cached details. */
export function clearVersionDetailsCache(): void {
  cache.clear();
}

// ── Controller ───────────────────────────────────────────────────────────────

export function createVersionDetails(deps: VersionDetailsDeps) {
  const states = new Map<string, ShallowRef<DetailsState>>();
  const inFlight = new Map<string, Promise<void>>();

  /** Reactive state of one snapshot (created on first access, cache-aware). */
  function state(snapshotId: string): Readonly<ShallowRef<DetailsState>> {
    let s = states.get(snapshotId);
    if (!s) {
      const view = cache.get(cacheKey(deps.projectId, snapshotId)) ?? null;
      s = shallowRef<DetailsState>({ status: view ? 'ready' : 'idle', view, error: null });
      states.set(snapshotId, s);
    }
    return s;
  }

  /**
   * Loads the details of `snapshotId` compared to `compareToId` (its older
   * neighbour in the list; omitted = let the server pick it). No-op when
   * already loaded or loading.
   */
  function load(snapshotId: string, compareToId?: string | null): Promise<void> {
    const s = state(snapshotId) as ShallowRef<DetailsState>;
    if (s.value.status === 'ready') return Promise.resolve();
    const running = inFlight.get(snapshotId);
    if (running) return running;

    const client = deps.client();
    if (!deps.online.value || !client) {
      s.value = { status: 'offline', view: null, error: null };
      return Promise.resolve();
    }
    s.value = { status: 'loading', view: null, error: null };
    const p = (async () => {
      try {
        const res = await getSnapshotDetails(client, { projectId: deps.projectId, snapshotId, compareToId });
        if (res.ok) {
          const view = buildVersionDetailsView(res.data, deps.diffOptions?.() ?? {});
          remember(cacheKey(deps.projectId, snapshotId), view);
          s.value = { status: 'ready', view, error: null };
        }
        else if (res.error.kind === 'network') {
          s.value = { status: 'offline', view: null, error: null };
        }
        else {
          console.warn('[version-details] load failed:', res.error.message);
          s.value = { status: 'error', view: null, error: 'Could not load the changes.' };
        }
      }
      catch (err) {
        console.error('[version-details] load failed:', err);
        s.value = { status: 'error', view: null, error: 'Could not load the changes.' };
      }
      finally {
        inFlight.delete(snapshotId);
      }
    })();
    inFlight.set(snapshotId, p);
    return p;
  }

  return { state, load };
}

export type VersionDetails = ReturnType<typeof createVersionDetails>;
