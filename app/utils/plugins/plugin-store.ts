/**
 * Plugin store (main thread, ADR §6.10).
 *
 * Knows every content plugin the app can use, by content hash, and resolves
 * unknown hashes in this order: memory → IndexedDB cache → built-ins
 * (`/plugins/<hex>.wasm`, manifests embedded in `builtin-index.ts`) →
 * Supabase. Packages from other users are recompiled from source and must
 * reproduce their hash before they are used (ADR §6.7).
 *
 * `getManifest` stays synchronous (packet encoding, UI); `pluginRevision`
 * bumps whenever a plugin becomes known so reactive lists update.
 */
import { shallowRef } from 'vue';
import type { ContentPluginManifest, ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';
import { hashPackage } from '@pixelmapper/plugin-toolchain/hash';
import { BUILTIN_PLUGINS } from './builtin-index';
import { createIdbCache, createMemoryCache, type PluginCache } from './plugin-cache';
import type { PluginRemote, PluginVisibility, RemotePluginInfo } from './plugin-remote';

/** A plugin known to this client. */
export interface KnownPlugin {
  hash: string;
  manifest: ContentPluginManifest;
  builtin: boolean;
  /** Compiled module, once loaded. */
  wasm?: Uint8Array;
  /** Full package (non-built-ins). */
  pkg?: ContentPluginPackage;
}

/** Where a listed plugin comes from. */
export type PluginOrigin = 'builtin' | 'mine' | 'project' | 'public' | 'local';

/** A listing entry (`listAvailable`). */
export interface AvailablePlugin {
  hash: string;
  manifest: ContentPluginManifest;
  origin: PluginOrigin;
}

const plugins = new Map<string, KnownPlugin>(
  BUILTIN_PLUGINS.map(p => [p.hash, { hash: p.hash, manifest: p.manifest, builtin: true }]),
);

/** Bumped whenever plugins are added (reactive dependency for lists). */
export const pluginRevision = shallowRef(0);

// ── Configuration ────────────────────────────────

let cache: PluginCache = typeof indexedDB === 'undefined' ? createMemoryCache() : createIdbCache();
let remote: PluginRemote | null = null;

/** Recompiles a foreign package and compares the hash (lazy: loads the compiler). */
let verifySource: (pkg: ContentPluginPackage) => Promise<{ ok: boolean; error?: string }> = async (pkg) => {
  const { verifyPackage } = await import('@pixelmapper/plugin-toolchain');
  return verifyPackage(pkg);
};

/** Installs the remote registry (client plugin) and/or a cache (tests). */
export function configurePluginStore(opts: {
  remote?: PluginRemote | null;
  cache?: PluginCache;
  verify?: typeof verifySource;
}): void {
  if (opts.remote !== undefined) remote = opts.remote;
  if (opts.cache) cache = opts.cache;
  if (opts.verify) verifySource = opts.verify;
}

/** The installed remote registry (null offline / signed out). */
export function getRemote(): PluginRemote | null {
  return remote;
}

// ── Synchronous lookups ──────────────────────────

/** Manifest of a known plugin (synchronous). */
export function getManifest(hash: string): ContentPluginManifest | undefined {
  return plugins.get(hash)?.manifest;
}

/** All known plugins: built-ins first, then by name. */
export function listPlugins(): KnownPlugin[] {
  void pluginRevision.value;
  return [...plugins.values()].sort((a, b) =>
    Number(b.builtin) - Number(a.builtin) || a.manifest.name.localeCompare(b.manifest.name));
}

/** True for built-in hashes. */
export function isBuiltin(hash: string): boolean {
  return plugins.get(hash)?.builtin ?? false;
}

/** Full package of a known non-built-in plugin. */
export function getPackage(hash: string): ContentPluginPackage | undefined {
  return plugins.get(hash)?.pkg;
}

// ── Registration ─────────────────────────────────

/** Makes a package known in memory (no persistence). */
function remember(pkg: ContentPluginPackage): void {
  if (plugins.get(pkg.hash)?.pkg) return;
  plugins.set(pkg.hash, { hash: pkg.hash, manifest: pkg.manifest, builtin: false, wasm: pkg.wasm, pkg });
  pluginRevision.value++;
}

/**
 * Registers a package (created, imported or received) and caches it. The
 * caller is responsible for its integrity (built or verified locally).
 */
export function registerPackage(pkg: ContentPluginPackage): void {
  remember(pkg);
  void cache.put(pkg).catch(err => console.warn('[plugin-store] cache write failed:', err));
}

// ── Resolution ───────────────────────────────────

/** URL of a built-in artifact. */
function builtinUrl(hash: string, ext: 'wasm' | 'json'): string {
  return `/plugins/${hash.replace(/^sha256:/, '')}.${ext}`;
}

/** In-flight resolutions (one per hash). */
const resolving = new Map<string, Promise<KnownPlugin | null>>();

/** Hashes that failed to resolve, with the reason (UI). */
export const resolveErrors = shallowRef<ReadonlyMap<string, string>>(new Map());

/** Records a failure reason. */
function fail(hash: string, reason: string): null {
  const next = new Map(resolveErrors.value);
  next.set(hash, reason);
  resolveErrors.value = next;
  console.warn(`[plugin-store] cannot resolve ${hash}: ${reason}`);
  return null;
}

/** Forgets a failure and resolves again (UI retry). */
export function retryResolve(hash: string): Promise<KnownPlugin | null> {
  if (resolveErrors.value.has(hash)) {
    const next = new Map(resolveErrors.value);
    next.delete(hash);
    resolveErrors.value = next;
  }
  return resolve(hash);
}

/** Resolution state of a hash for UI (reactive via `pluginRevision` / `resolveErrors`). */
export function pluginStatus(hash: string): { state: 'ready' } | { state: 'pending' } | { state: 'error'; error: string } {
  void pluginRevision.value;
  if (plugins.has(hash)) return { state: 'ready' };
  const error = resolveErrors.value.get(hash);
  return error ? { state: 'error', error } : { state: 'pending' };
}

/** Checks a cached/received package: hash over manifest ‖ wasm ‖ ui. */
async function intact(pkg: ContentPluginPackage): Promise<boolean> {
  return (await hashPackage(pkg.manifest, pkg.wasm, pkg.uiJs)) === pkg.hash;
}

/**
 * Resolves a hash to a known plugin: memory → IndexedDB → built-in → remote.
 * Remote packages from other users are recompiled from source first.
 * Returns null (and records `resolveErrors`) when the plugin is unavailable.
 */
export function resolve(hash: string): Promise<KnownPlugin | null> {
  const known = plugins.get(hash);
  if (known && (known.builtin || known.pkg)) return Promise.resolve(known);
  let p = resolving.get(hash);
  if (!p) {
    p = resolveUncached(hash).finally(() => resolving.delete(hash));
    resolving.set(hash, p);
  }
  return p;
}

/** Resolution without memory/in-flight dedupe. */
async function resolveUncached(hash: string): Promise<KnownPlugin | null> {
  const cached = await cache.get(hash).catch(() => null);
  if (cached && await intact(cached)) {
    remember(cached);
    return plugins.get(hash)!;
  }
  if (!remote) return fail(hash, 'not available offline');
  try {
    const pkg = await remote.fetch(hash);
    if (!pkg) return fail(hash, 'not found or not shared with you');
    const { ownerId, ...plain } = pkg;
    if (!await intact(plain)) return fail(hash, 'package does not match its hash');
    if (ownerId !== await remote.userId()) {
      const v = await verifySource(plain);
      if (!v.ok) return fail(hash, v.error ?? 'source verification failed');
    }
    registerPackage(plain);
    return plugins.get(hash)!;
  }
  catch (err) {
    return fail(hash, (err as Error).message);
  }
}

/**
 * Compiled module bytes of a plugin: memory → built-in file → `resolve`.
 * Returns null when the plugin is unavailable.
 */
export async function loadWasm(hash: string): Promise<Uint8Array | null> {
  const known = plugins.get(hash);
  if (known?.wasm) return known.wasm;
  if (known?.builtin) {
    try {
      const res = await fetch(builtinUrl(hash, 'wasm'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      known.wasm = new Uint8Array(await res.arrayBuffer());
      return known.wasm;
    }
    catch (err) {
      console.error(`[plugin-store] cannot load built-in ${hash}:`, err);
      return null;
    }
  }
  return (await resolve(hash))?.wasm ?? null;
}

// ── Publishing & listing ─────────────────────────

/**
 * Publishes a package to the remote registry (and registers it locally).
 * Built-ins are never uploaded.
 */
export async function publish(pkg: ContentPluginPackage, visibility: PluginVisibility, projectId?: string | null): Promise<void> {
  if (isBuiltin(pkg.hash)) return;
  registerPackage(pkg);
  if (!remote) throw new Error('publishing needs a signed-in session');
  await remote.publish(pkg, visibility, projectId ?? null);
}

/**
 * Plugins the user can add: built-ins, own (remote + locally cached),
 * the project's and public ones. Deduplicated by hash (first origin wins).
 */
export async function listAvailable(opts: { projectId?: string; includePublic?: boolean } = {}): Promise<AvailablePlugin[]> {
  const out = new Map<string, AvailablePlugin>();
  const add = (hash: string, manifest: ContentPluginManifest, origin: PluginOrigin) => {
    if (!out.has(hash)) out.set(hash, { hash, manifest, origin });
  };
  for (const p of BUILTIN_PLUGINS) add(p.hash, p.manifest, 'builtin');

  let rows: RemotePluginInfo[] = [];
  if (remote) {
    try {
      rows = await remote.list({ mine: true, projectId: opts.projectId, public: opts.includePublic });
    }
    catch (err) {
      console.warn('[plugin-store] remote listing failed:', err);
    }
  }
  const uid = remote ? await remote.userId().catch(() => null) : null;
  for (const r of rows) if (r.ownerId === uid) add(r.hash, r.manifest, 'mine');
  for (const r of rows) if (opts.projectId && r.projectId === opts.projectId) add(r.hash, r.manifest, 'project');
  for (const r of rows) if (r.visibility === 'public') add(r.hash, r.manifest, 'public');
  for (const pkg of await cache.all().catch(() => [])) add(pkg.hash, pkg.manifest, 'local');
  for (const p of plugins.values()) if (!p.builtin) add(p.hash, p.manifest, 'local');
  return [...out.values()];
}
