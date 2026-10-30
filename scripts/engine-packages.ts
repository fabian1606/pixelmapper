/**
 * Locations of the engine WASM packages (wasm-pack output).
 *
 * `rs-engine-core` and `rs-engine-canvas` are built into the crates' own
 * `pkg/` dirs (gitignored by wasm-pack) and imported through an alias
 * (nuxt.config.ts, vitest.config.ts) — never through `node_modules`:
 * - `bun install` deletes unknown dirs in `node_modules`, so a build written
 *   there disappeared on every install (silent black output, see
 *   architecture/engine.md).
 * - Bare `node_modules` resolution walks up the directory tree: a checkout
 *   nested in another one (git worktrees under `.claude/worktrees/`) silently
 *   picked up the parent checkout's older engine build.
 */
import { fileURLToPath } from 'node:url';

/** Repository root (this file lives in `scripts/`). */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** One engine package: crate dir and its wasm-pack output. */
export interface EnginePackage {
  /** npm-style import name (also the alias key). */
  name: 'rs-engine-core' | 'rs-engine-canvas';
  /** Crate dir relative to the repo root. */
  crate: string;
  /** wasm-pack output dir relative to the repo root. */
  pkg: string;
  /** The `.wasm` binary inside `pkg`. */
  wasm: string;
}

/** Both engine packages. */
export const ENGINE_PACKAGES: readonly EnginePackage[] = [
  { name: 'rs-engine-core', crate: 'rs-engine/core', pkg: 'rs-engine/core/pkg', wasm: 'rs_engine_core_bg.wasm' },
  { name: 'rs-engine-canvas', crate: 'rs-engine/canvas', pkg: 'rs-engine/canvas/pkg', wasm: 'rs_engine_canvas_bg.wasm' },
];

/** Absolute path of a package's output dir. */
export function enginePkgDir(name: EnginePackage['name'], root: string = REPO_ROOT): string {
  const entry = ENGINE_PACKAGES.find(p => p.name === name)!;
  return `${root.replace(/\/$/, '')}/${entry.pkg}`;
}

/** Import aliases `rs-engine-*` → absolute `pkg/` dirs (Vite / Nuxt / Vitest). */
export function enginePackageAliases(root: string = REPO_ROOT): Record<string, string> {
  return Object.fromEntries(ENGINE_PACKAGES.map(p => [p.name, enginePkgDir(p.name, root)]));
}
