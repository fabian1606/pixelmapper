/**
 * check-optimize-deps — regression check for Vite's dep optimizer in dev.
 *
 * Usage: `bun run scripts/check-optimize-deps.ts [--tauri] [--keep-log]`
 *
 * Problem: when Vite discovers a bare dependency only while the browser
 * requests a module, it re-optimizes, changes the browserHash and (on a
 * hash change) sends a full reload. The Tauri WKWebView then fails with
 * "504 (Outdated Optimize Dep)" / "Importing a module script failed" or ends
 * up with two copies of Vue. The fix is listing such deps in
 * `vite.optimizeDeps.include` in nuxt.config.ts.
 *
 * What this script does:
 * 1. Starts `nuxt dev` on a free port with a fresh, temporary Vite cache
 *    (`PM_VITE_CACHE_DIR`) and Nuxt build dir (`PM_BUILD_DIR`), so no other
 *    dev server's `.nuxt` / deps cache is touched. `--tauri` sets
 *    `TAURI_ENV_PLATFORM=darwin` (desktop flavour: SPA, extra includes).
 * 2. Waits until the cold-start optimizer run has committed
 *    `<cacheDir>/client/deps/_metadata.json` and settled. That set (scanner
 *    + `optimizeDeps.include` + Nuxt's warmup crawl) is the baseline: what a
 *    webview opening right after the server is ready gets without reloading.
 * 3. Acts like a browser: fetches every top-level page route, then crawls the
 *    client module graph over HTTP (static imports, re-exports, dynamic
 *    `import()`, `new URL('…', import.meta.url)` workers), dedup'd and
 *    concurrency-limited.
 * 4. Waits for the optimizer to settle and compares the final metadata with
 *    the baseline. Also scans the server log for Vite's runtime discovery
 *    messages (verified against vite 7.3 `createDepsOptimizer`):
 *      - debug (`DEBUG=vite:deps`): "new dependencies found: a, b"
 *      - info: "✨ new dependencies optimized: a, b" (only without DEBUG)
 *      - info: "✨ optimized dependencies changed. reloading"
 *    and treats any 504 response during the crawl as failure.
 * 5. Exits 1 listing the missing deps, 0 otherwise. The dev server is always
 *    killed and the temp dirs removed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Configuration ────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_TAURI = process.argv.includes('--tauri');
const KEEP_LOG = process.argv.includes('--keep-log');
const FIRST_PORT = 3100;
/** Max time for `nuxt dev` to answer HTTP and finish the cold optimize run. */
const STARTUP_TIMEOUT_MS = 240_000;
/** Per-request timeout (first transforms of big modules can be slow). */
const REQUEST_TIMEOUT_MS = 90_000;
/** Parallel module fetches during the crawl. */
const CONCURRENCY = 8;
/** Optimizer counts as settled after this long without metadata/log change. */
const SETTLE_IDLE_MS = 5_000;
/** Upper bound for a settle wait. */
const SETTLE_TIMEOUT_MS = 120_000;
/** Hard cap on crawled URLs (guards against runaway query-string loops). */
const MAX_URLS = 5_000;
const HINT = 'add to vite.optimizeDeps.include in nuxt.config.ts';

// ── Small helpers ────────────────────────────

/** Promise-based sleep. */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Removes ANSI colour codes (Vite/debug output is coloured). */
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

/** Resolves true when `port` can be bound on localhost (i.e. it is free). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => done(true)));
  });
}

/** First free port at or above FIRST_PORT. */
async function findFreePort(): Promise<number> {
  for (let p = FIRST_PORT; p < FIRST_PORT + 200; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('no free port found');
}

/** Page routes derived from `app/pages` file names; dynamic segments get a dummy value. */
async function pageRoutes(): Promise<string[]> {
  const pagesDir = join(ROOT, 'app', 'pages');
  const routes = new Set<string>(['/']);
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(p); continue; }
      if (!entry.name.endsWith('.vue')) continue;
      const rel = relative(pagesDir, p).replace(/\.vue$/, '').split(/[\\/]/);
      if (rel[rel.length - 1] === 'index') rel.pop();
      // `[param]` → dummy value, `[...slug]` → dummy path segment.
      const route = '/' + rel.map(seg => seg.replace(/\[(?:\.\.\.)?[^\]]+\]/g, 'check-dummy')).join('/');
      routes.add(route);
    }
  };
  if (existsSync(pagesDir)) await walk(pagesDir);
  return [...routes];
}

/** String literals of the `optimizeDeps.include` array in nuxt.config.ts (informational only). */
async function configuredIncludes(): Promise<Set<string>> {
  const src = await readFile(join(ROOT, 'nuxt.config.ts'), 'utf8');
  const block = src.match(/include:\s*\[([\s\S]*?)\n\s*\],/)?.[1] ?? '';
  return new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1]!));
}

// ── Dev server ───────────────────────────────

/** Running `nuxt dev` process plus its accumulated output. */
interface DevServer {
  proc: ChildProcess;
  /** Combined stdout + stderr, ANSI stripped. */
  log: () => string;
  /** Timestamp of the last output chunk. */
  lastOutputAt: () => number;
  exited: () => boolean;
}

/** Spawns `nuxt dev` in its own process group (so the forked child dies with it). */
function startDevServer(port: number, env: Record<string, string>): DevServer {
  let out = '';
  let lastAt = Date.now();
  let hasExited = false;
  const proc = spawn('bun', ['x', 'nuxt', 'dev', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (chunk: Buffer) => { out += stripAnsi(chunk.toString()); lastAt = Date.now(); };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('exit', () => { hasExited = true; });
  return { proc, log: () => out, lastOutputAt: () => lastAt, exited: () => hasExited };
}

/** Kills the whole process group of the dev server (SIGTERM, then SIGKILL). */
async function stopDevServer(server: DevServer | undefined): Promise<void> {
  if (!server?.proc.pid || server.exited()) return;
  const pgid = server.proc.pid;
  try { process.kill(-pgid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 50 && !server.exited(); i++) await sleep(100);
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
}

// ── Optimizer metadata ───────────────────────

/** Subset of Vite's `_metadata.json` this check needs. */
interface DepsMetadata {
  browserHash: string;
  optimized: Record<string, unknown>;
}

/** Path of the client deps metadata inside the temp cache dir. */
const metadataPath = (cacheDir: string) => join(cacheDir, 'client', 'deps', '_metadata.json');

/** Reads `_metadata.json`; undefined while it does not exist (yet) or is mid-write. */
async function readMetadata(cacheDir: string): Promise<DepsMetadata | undefined> {
  try {
    return JSON.parse(await readFile(metadataPath(cacheDir), 'utf8')) as DepsMetadata;
  } catch {
    return undefined;
  }
}

/** mtime of `_metadata.json` (0 when missing). */
async function metadataMtime(cacheDir: string): Promise<number> {
  try { return (await stat(metadataPath(cacheDir))).mtimeMs; } catch { return 0; }
}

/** True while Vite has a `deps_temp_*` processing dir (an optimize run is in flight). */
async function optimizerBusy(cacheDir: string): Promise<boolean> {
  try {
    return (await readdir(join(cacheDir, 'client'))).some(n => n.startsWith('deps_temp'));
  } catch {
    return false;
  }
}

/**
 * Waits until the metadata exists, no optimize run is in flight and neither
 * the metadata nor the server log changed for SETTLE_IDLE_MS.
 */
async function waitForSettle(cacheDir: string, server: DevServer, timeoutMs: number): Promise<DepsMetadata> {
  const deadline = Date.now() + timeoutMs;
  let lastMtime = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    if (server.exited()) throw new Error('nuxt dev exited unexpectedly');
    const mtime = await metadataMtime(cacheDir);
    const busy = await optimizerBusy(cacheDir);
    if (mtime !== lastMtime || busy || mtime === 0) { lastMtime = mtime; stableSince = Date.now(); }
    const quietFor = Date.now() - Math.max(stableSince, server.lastOutputAt());
    if (mtime > 0 && !busy && quietFor >= SETTLE_IDLE_MS) {
      const meta = await readMetadata(cacheDir);
      if (meta) return meta;
    }
    await sleep(250);
  }
  throw new Error(`optimizer did not settle within ${timeoutMs / 1000}s`);
}

// ── HTTP crawl ───────────────────────────────

/** Outcome of the browser-like crawl. */
interface CrawlResult {
  fetched: number;
  outdated: string[];
  errors: { url: string; status: number | string }[];
  workers: string[];
}

/** Fetch with timeout; never throws (returns the error message instead). */
async function fetchWithTimeout(url: string): Promise<Response | string> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Module URLs referenced by an HTML document (module scripts and modulepreload links). */
function htmlModuleUrls(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>/gi)) {
    const src = m[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src) urls.push(src);
  }
  for (const m of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi)) {
    const href = m[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) urls.push(href);
  }
  // Inline module scripts (Nuxt SPA shells) may import the entry directly.
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    urls.push(...jsModuleUrls(m[1] ?? '').map(r => r.spec));
  }
  return urls;
}

/** Module specifiers referenced by served JS; `worker` marks `new URL(…, import.meta.url)`. */
function jsModuleUrls(code: string): { spec: string; worker: boolean }[] {
  const found: { spec: string; worker: boolean }[] = [];
  const patterns: [RegExp, boolean][] = [
    // import x from '…' / import { a } from '…' / import '…'
    [/\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?(["'])([^"'\n]+?)\1/g, false],
    // export { a } from '…' / export * from '…'
    [/\bexport\s*(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*(["'])([^"'\n]+?)\1/g, false],
    // import('…') with a literal specifier (Vite may prefix `/* @vite-ignore */`)
    [/\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?(["'`])([^"'`\n]+?)\1\s*[,)]/g, false],
    // new URL('…', import.meta.url) — workers, wasm, assets
    [/\bnew\s+URL\s*\(\s*(?:\/\*[^*]*\*\/\s*)?(["'`])([^"'`\n]+?)\1\s*,\s*import\.meta\.url\s*\)/g, true],
  ];
  for (const [re, worker] of patterns) {
    for (const m of code.matchAll(re)) found.push({ spec: m[2]!, worker });
  }
  return found;
}

/**
 * Crawls page routes and the client module graph like a browser would.
 * Same-origin only, dedup'd by full URL, CONCURRENCY parallel fetches.
 */
async function crawl(origin: string, routes: string[], cacheDir: string): Promise<CrawlResult> {
  /** True for URLs served from the optimizer's deps dir (`…/client/deps/x.js?v=…`). */
  const isOptimizedDep = (url: string) => decodeURIComponent(new URL(url).pathname).includes(join(cacheDir, 'client', 'deps') + '/');
  const result: CrawlResult = { fetched: 0, outdated: [], errors: [], workers: [] };
  const seen = new Set<string>();
  const queue: string[] = [];

  /** Queues a URL (resolved against `base`) if it is same-origin and new. */
  const enqueue = (spec: string, base: string) => {
    if (/^(data|blob|javascript):/.test(spec)) return;
    let url: URL;
    try { url = new URL(spec, base); } catch { return; }
    if (url.origin !== origin) return;
    url.hash = '';
    const key = url.href;
    if (seen.has(key) || seen.size >= MAX_URLS) return;
    seen.add(key);
    queue.push(key);
  };

  /** Fetches one URL and enqueues what it references. */
  const visit = async (url: string) => {
    const res = await fetchWithTimeout(url);
    result.fetched++;
    if (typeof res === 'string') { result.errors.push({ url, status: res }); return; }
    if (res.status === 504) { result.outdated.push(url); await res.body?.cancel(); return; }
    if (!res.ok) {
      // A failing module (e.g. an unresolvable WASM package) must not abort the crawl.
      result.errors.push({ url, status: res.status });
      await res.body?.cancel();
      return;
    }
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('html')) {
      for (const u of htmlModuleUrls(await res.text())) enqueue(u, res.url);
    } else if (isOptimizedDep(url)) {
      // Pre-bundled deps cannot trigger discovery; their string literals only
      // produce bogus URLs. Fetching them is enough to catch a 504.
      await res.body?.cancel();
    } else if (type.includes('javascript') || type.includes('typescript')) {
      for (const { spec, worker } of jsModuleUrls(await res.text())) {
        // Bare specifiers in served code would be an import-analysis bug; skip them.
        if (!/^(\/|\.\.?\/|https?:)/.test(spec)) continue;
        if (worker) result.workers.push(new URL(spec, url).pathname);
        enqueue(spec, url);
      }
    } else {
      await res.body?.cancel();
    }
  };

  // Page HTML first, one at a time: parallel SSR renders in Nuxt dev trip
  // over each other (pinia/console.time collisions → spurious 500s).
  for (const route of routes) {
    const url = new URL(route, origin).href;
    seen.add(url);
    await visit(url);
  }
  if (queue.length === 0) throw new Error('no module script found in any page HTML');
  let inFlight = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    // Each worker pulls until the queue stays empty while no one is fetching.
    while (true) {
      const next = queue.shift();
      if (next) { inFlight++; try { await visit(next); } finally { inFlight--; } continue; }
      if (inFlight === 0) return;
      await sleep(50);
    }
  });
  await Promise.all(workers);
  return result;
}

// ── Log analysis ─────────────────────────────

/** Deps named by Vite's runtime discovery messages in the server output. */
function runtimeDiscoveriesFromLog(log: string): { deps: Set<string>; reloads: number } {
  const deps = new Set<string>();
  for (const m of log.matchAll(/new dependencies (?:found|optimized):\s*([^\n]+)/g)) {
    for (const d of m[1]!.split(',')) if (d.trim()) deps.add(d.trim());
  }
  const reloads = (log.match(/optimized dependencies changed\. reloading/g) ?? []).length;
  return { deps, reloads };
}

/** Deps listed by the `DEBUG=vite:deps` "Scan completed" message. */
function scannedDepsFromLog(log: string): Set<string> {
  const block = log.match(/Scan completed in [\d.]+ms:([\s\S]*?)(?:\n(?!\s{2,}\S+ -> )|$)/)?.[1] ?? '';
  return new Set([...block.matchAll(/^\s+(\S+) -> /gm)].map(m => m[1]!));
}

// ── Main ─────────────────────────────────────

async function main(): Promise<number> {
  const flavour = IS_TAURI ? 'tauri (TAURI_ENV_PLATFORM=darwin, SPA)' : 'web (SSR)';
  const tmp = await mkdtemp(join(tmpdir(), 'pm-optimize-deps-'));
  const cacheDir = join(tmp, 'vite-cache');
  const buildDir = join(tmp, 'nuxt-build');
  const started = Date.now();
  let server: DevServer | undefined;

  // Always clean up, also on Ctrl+C.
  const cleanup = async () => {
    await stopDevServer(server);
    if (!KEEP_LOG) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  };
  process.once('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

  try {
    const port = await findFreePort();
    const origin = `http://127.0.0.1:${port}`;
    console.info(`[optimize-deps] flavour: ${flavour}`);
    console.info(`[optimize-deps] starting nuxt dev on ${origin} (cache ${cacheDir})`);
    server = startDevServer(port, {
      PM_VITE_CACHE_DIR: cacheDir,
      PM_BUILD_DIR: buildDir,
      // Scanner result + "new dependencies found" (the info-level
      // "new dependencies optimized" line is suppressed while this is set).
      DEBUG: 'vite:deps',
      ...(IS_TAURI ? { TAURI_ENV_PLATFORM: 'darwin' } : {}),
    });

    // 1. Wait for the cold-start optimize run (scanner + include + warmup).
    const baseline = await waitForSettle(cacheDir, server, STARTUP_TIMEOUT_MS);
    const baselineDeps = new Set(Object.keys(baseline.optimized));
    const logAtBaseline = server.log().length;
    console.info(`[optimize-deps] startup optimized ${baselineDeps.size} deps after ${((Date.now() - started) / 1000).toFixed(1)}s`);

    // 2. Browser-like crawl of pages and the client module graph.
    const routes = await pageRoutes();
    console.info(`[optimize-deps] crawling routes: ${routes.join(', ')}`);
    const crawlResult = await crawl(origin, routes, cacheDir);
    console.info(`[optimize-deps] fetched ${crawlResult.fetched} URLs (${crawlResult.errors.length} errors, ${crawlResult.outdated.length} × 504)`);
    if (crawlResult.workers.length) console.info(`[optimize-deps] worker / new URL() refs: ${[...new Set(crawlResult.workers)].join(', ')}`);

    // 3. Let a re-optimization triggered by the crawl finish.
    const final = await waitForSettle(cacheDir, server, SETTLE_TIMEOUT_MS);
    const runtimeLog = server.log().slice(logAtBaseline);
    const fromLog = runtimeDiscoveriesFromLog(runtimeLog);
    const fromMeta = Object.keys(final.optimized).filter(d => !baselineDeps.has(d));
    const missing = [...new Set([...fromMeta, ...fromLog.deps])].sort();

    // Informational: baseline deps neither scanned nor included (found by
    // Nuxt's warmup crawl only — fine in practice, but timing-dependent).
    const scanned = scannedDepsFromLog(server.log());
    const included = await configuredIncludes();
    const warmupOnly = scanned.size
      ? [...baselineDeps].filter(d => !scanned.has(d) && !included.has(d)).sort()
      : [];

    for (const e of crawlResult.errors.slice(0, 20)) console.warn(`[optimize-deps] ${e.status} ${e.url}`);
    if (crawlResult.errors.length > 20) console.warn(`[optimize-deps] … ${crawlResult.errors.length - 20} more errors`);
    if (warmupOnly.length) console.warn(`[optimize-deps] note: found only by Nuxt's warmup crawl (not scanner/include): ${warmupOnly.join(', ')}`);
    console.info(`[optimize-deps] browserHash ${baseline.browserHash} → ${final.browserHash}, done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    const failed = missing.length > 0 || crawlResult.outdated.length > 0 || fromLog.reloads > 0;
    if (!failed) {
      console.info('[optimize-deps] OK — no dependency was discovered at runtime');
      return 0;
    }
    if (missing.length) {
      console.error(`[optimize-deps] FAIL — deps discovered only at runtime (${HINT}):`);
      for (const d of missing) console.error(`  - '${d}'`);
    }
    if (fromLog.reloads) console.error(`[optimize-deps] FAIL — Vite logged "optimized dependencies changed. reloading" ${fromLog.reloads}×`);
    if (crawlResult.outdated.length) {
      console.error(`[optimize-deps] FAIL — ${crawlResult.outdated.length} × 504 Outdated Optimize Dep, e.g. ${crawlResult.outdated.slice(0, 3).join(', ')}`);
    }
    return 1;
  } catch (e) {
    console.error('[optimize-deps] error:', e instanceof Error ? e.message : e);
    if (server) console.error(server.log().split('\n').slice(-40).join('\n'));
    return 1;
  } finally {
    if (KEEP_LOG && server) {
      await Bun.write(join(tmp, 'server.log'), server.log());
      console.info(`[optimize-deps] log kept at ${join(tmp, 'server.log')}`);
    }
    await cleanup();
  }
}

process.exit(await main());
