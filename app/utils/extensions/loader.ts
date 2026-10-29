/**
 * Runtime extension loader (ADR §5.9 boot step 3, plan P6.6).
 *
 * Installed extensions (per user: Supabase `user_extensions` when signed in,
 * else localStorage) are loaded before any project opens:
 *   1. pick the highest version satisfying the installed range from the
 *      local cache, else from the sources (app catalog, Supabase registry);
 *   2. download into the IndexedDB cache (offline afterwards);
 *   3. inject the bundle's CSS, `import()` its JS from a blob URL — the
 *      bundle reads vue/pinia/the API from the shared globals — and
 *      register the default-exported manifest.
 *
 * Layer extensions with the same id win (already registered). Install and
 * uninstall change the list and reload the app (installed = active, D19).
 */
import semver from 'semver';
import type { ExtensionManifest } from '@pixelmapper/extension-api';
import { isOnline } from '~/utils/sync/connectivity';
import { getExtension, registerExtension } from './registry';
import { createIdbBundleCache, createMemoryBundleCache, type BundleCache, type CachedBundle } from './extension-cache';
import type { ExtensionListing, ExtensionSource } from './extension-sources';

/** One installed extension. */
export interface InstalledExtension {
  id: string;
  /** Semver range, e.g. `^1.2` or `*`. */
  versionRange: string;
}

/** Persistence of the installed list. */
export interface InstalledStore {
  list(): Promise<InstalledExtension[]>;
  set(list: InstalledExtension[]): Promise<void>;
}

/** Result of loading one extension. */
export interface LoadResult {
  id: string;
  version?: string;
  status: 'loaded' | 'layer' | 'missing' | 'failed';
  error?: string;
}

/** localStorage key of a user's installed list. */
export function installedKey(userId: string | null): string {
  return `pm:installed-extensions:${userId ?? 'local'}`;
}

/** localStorage-backed installed list. */
export function localInstalledStore(userId: string | null): InstalledStore {
  return {
    async list() {
      try {
        const v = JSON.parse(localStorage.getItem(installedKey(userId)) ?? '[]');
        return Array.isArray(v) ? v.filter(x => typeof x?.id === 'string') : [];
      }
      catch {
        return [];
      }
    },
    async set(list) {
      try { localStorage.setItem(installedKey(userId), JSON.stringify(list)); }
      catch (err) { console.warn('[extensions] cannot persist installed list:', err); }
    },
  };
}

// ── Remote timeouts ──────────────────────────────

/**
 * Max wait for one remote call (installed list, source listing). Every
 * Supabase data call first awaits `auth.getSession()`, which retries an
 * expired-token refresh for ~30 s while offline (ADR 0004 D10).
 */
export const REMOTE_TIMEOUT_MS = 4000;

/** Resolves with the value, or null after `ms` (the promise keeps running). */
export async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  }
  finally {
    if (timer != null) clearTimeout(timer);
  }
}

// ── Loader state ─────────────────────────────────

let cache: BundleCache = typeof indexedDB === 'undefined' ? createMemoryBundleCache() : createIdbBundleCache();
let sources: ExtensionSource[] = [];
let installed: InstalledStore = localInstalledStore(null);
let ready: Promise<LoadResult[]> = Promise.resolve([]);
let reload: () => void = () => { if (typeof location !== 'undefined') location.reload(); };

/** Configures the loader (client plugin; tests). */
export function configureLoader(opts: { cache?: BundleCache; sources?: ExtensionSource[]; installed?: InstalledStore; reload?: () => void }): void {
  if (opts.cache) cache = opts.cache;
  if (opts.sources) sources = opts.sources;
  if (opts.installed) installed = opts.installed;
  if (opts.reload) reload = opts.reload;
}

/** Resolves when installed extensions are loaded (await before opening projects). */
export function extensionsReady(): Promise<LoadResult[]> {
  return ready;
}

/** All listings from all sources and the local cache (deduplicated by id@version). */
export async function listAvailableExtensions(): Promise<ExtensionListing[]> {
  const out = new Map<string, ExtensionListing>();
  // Cached bundles (e.g. from an imported project) are installable offline.
  for (const b of await cache.all().catch(() => [] as CachedBundle[])) {
    const info = b.info as Partial<Record<'apiVersion' | 'displayName' | 'description', string>>;
    out.set(`${b.id}@${b.version}`, { id: b.id, version: b.version, apiVersion: info.apiVersion ?? '*', displayName: info.displayName ?? b.id, description: info.description ?? '', source: 'cache' });
  }
  for (const s of sources) {
    // A hanging remote (e.g. auth refresh offline) must not stall boot.
    const listed = await withTimeout(s.list(), REMOTE_TIMEOUT_MS).catch(() => null);
    for (const l of listed ?? []) {
      if (!out.has(`${l.id}@${l.version}`)) out.set(`${l.id}@${l.version}`, l);
    }
  }
  return [...out.values()];
}

/** Highest version satisfying a range among candidates. */
export function pickVersion(versions: string[], range: string): string | null {
  return semver.maxSatisfying(versions.filter(v => semver.valid(v)), range || '*');
}

/**
 * A cached bundle, downloading it when absent. `listings` lets a boot pass
 * share one source listing for all installed extensions.
 */
async function obtain(id: string, range: string, listings: () => Promise<ExtensionListing[]> = listAvailableExtensions): Promise<CachedBundle | null> {
  const cached = pickVersion(await cache.versions(id), range);
  // Prefer the newest published version satisfying the range when online.
  const matching = (await listings()).filter(l => l.id === id);
  const published = pickVersion(matching.map(l => l.version), range);
  const version = published && (!cached || semver.gt(published, cached)) ? published : cached;
  if (!version) return null;
  const hit = await cache.get(id, version);
  if (hit) return hit;
  for (const s of sources) {
    try {
      const files = await s.fetch(id, version);
      const bundle: CachedBundle = { key: `${id}@${version}`, id, version, ...files };
      await cache.put(bundle);
      return bundle;
    }
    catch { /* try the next source */ }
  }
  return null;
}

/** A bundle satisfying a range (cache, else sources); null when unavailable. */
export function getBundle(id: string, range = '*'): Promise<CachedBundle | null> {
  return obtain(id, range);
}

/** Stores a bundle in the cache (project import). */
export function cacheBundle(bundle: CachedBundle): Promise<void> {
  return cache.put(bundle);
}

/** Injects a bundle's CSS once. */
function injectCss(bundle: CachedBundle): void {
  if (!bundle.css || typeof document === 'undefined') return;
  if (document.querySelector(`style[data-pm-extension="${bundle.key}"]`)) return;
  const style = document.createElement('style');
  style.dataset.pmExtension = bundle.key;
  style.textContent = bundle.css;
  document.head.appendChild(style);
}

/** Imports a bundle's JS and returns its manifest. */
async function importBundle(bundle: CachedBundle): Promise<ExtensionManifest> {
  const url = URL.createObjectURL(new Blob([bundle.js], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url) as { default?: ExtensionManifest };
    if (!mod.default?.id) throw new Error('bundle has no manifest default export');
    if (mod.default.id !== bundle.id) throw new Error(`bundle declares id "${mod.default.id}"`);
    return mod.default;
  }
  finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads one installed extension. */
export async function loadExtension(entry: InstalledExtension, listings?: () => Promise<ExtensionListing[]>): Promise<LoadResult> {
  if (getExtension(entry.id)) return { id: entry.id, status: 'layer' };
  try {
    const bundle = await obtain(entry.id, entry.versionRange, listings);
    if (!bundle) return { id: entry.id, status: 'missing', error: `no version satisfies ${entry.versionRange}` };
    injectCss(bundle);
    registerExtension(await importBundle(bundle), 'bundle');
    return { id: entry.id, version: bundle.version, status: 'loaded' };
  }
  catch (err) {
    console.error(`[extensions] cannot load ${entry.id}:`, err);
    return { id: entry.id, status: 'failed', error: (err as Error).message };
  }
}

/** Loads every installed extension (boot step 3). */
export function startLoading(): Promise<LoadResult[]> {
  ready = (async () => {
    const list = await installed.list().catch(() => [] as InstalledExtension[]);
    // One source listing per pass (each remote listing is bounded by a timeout).
    let listing: Promise<ExtensionListing[]> | null = null;
    const listings = () => (listing ??= listAvailableExtensions());
    const results: LoadResult[] = [];
    for (const entry of list) results.push(await loadExtension(entry, listings));
    return results;
  })();
  return ready;
}

/** The installed list. */
export function listInstalled(): Promise<InstalledExtension[]> {
  return installed.list();
}

/**
 * Installs (or updates) an extension: downloads it into the cache, records
 * it and reloads the app so it activates (D19). Returns false when no
 * version satisfies the range.
 */
export async function installExtension(id: string, versionRange = '*'): Promise<boolean> {
  const bundle = await obtain(id, versionRange);
  if (!bundle) return false;
  const range = versionRange === '*' ? `^${semver.major(bundle.version)}.${semver.minor(bundle.version)}` : versionRange;
  const list = (await installed.list()).filter(x => x.id !== id);
  await installed.set([...list, { id, versionRange: range }]);
  reload();
  return true;
}

/** Uninstalls an extension and reloads. */
export async function uninstallExtension(id: string): Promise<void> {
  await installed.set((await installed.list()).filter(x => x.id !== id));
  reload();
}

/**
 * Installed list in Supabase `user_extensions` (signed in), mirrored to
 * localStorage so the app boots offline with the last known list.
 */
export function supabaseInstalledStore(
  supabase: import('@supabase/supabase-js').SupabaseClient<import('~/types/database.types').Database>,
  userId: string,
): InstalledStore {
  const local = localInstalledStore(userId);
  return {
    async list() {
      // Offline or slow: the mirror is the last known list (no network wait).
      if (!isOnline.value) return local.list();
      const res = await withTimeout(
        supabase.from('user_extensions').select('extension_id, version_range').eq('user_id', userId),
        REMOTE_TIMEOUT_MS,
      ).catch(() => null);
      if (!res || res.error) return local.list();
      const list = (res.data ?? []).map(r => ({ id: r.extension_id, versionRange: r.version_range }));
      await local.set(list);
      return list;
    },
    async set(list) {
      await local.set(list);
      const { data } = await supabase.from('user_extensions').select('extension_id').eq('user_id', userId);
      const removed = (data ?? []).map(r => r.extension_id).filter(id => !list.some(x => x.id === id));
      if (removed.length) await supabase.from('user_extensions').delete().eq('user_id', userId).in('extension_id', removed);
      if (list.length) {
        await supabase.from('user_extensions').upsert(list.map(x => ({ user_id: userId, extension_id: x.id, version_range: x.versionRange })));
      }
    },
  };
}
