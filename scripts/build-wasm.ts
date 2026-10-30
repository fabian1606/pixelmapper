/**
 * Builds the engine WASM packages into `rs-engine/{core,canvas}/pkg`.
 *
 * Usage: bun run scripts/build-wasm.ts [--if-stale]
 *
 * `--if-stale` (used by `dev:nuxt` → `dev:tauri`, `build`, `generate`) only
 * rebuilds a package whose output is missing or older than its Rust sources,
 * so starting the app never runs against a missing or outdated engine.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_PACKAGES, REPO_ROOT, type EnginePackage } from './engine-packages';

const ifStale = process.argv.includes('--if-stale');

/** Newest mtime (ms) of all files below `path` (0 if absent). */
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
}

/** Why a package needs a build, or null when its output is current. */
export function staleReason(pkg: EnginePackage, root: string = REPO_ROOT): string | null {
  const wasm = join(root, pkg.pkg, pkg.wasm);
  if (!existsSync(wasm) || !existsSync(join(root, pkg.pkg, 'package.json'))) return 'output missing';
  const built = statSync(wasm).mtimeMs;
  const inputs = [
    join(root, pkg.crate, 'src'),
    join(root, pkg.crate, 'js'),
    join(root, pkg.crate, 'Cargo.toml'),
    join(root, 'rs-engine/Cargo.toml'),
    join(root, 'rs-engine/Cargo.lock'),
  ];
  const newest = Math.max(...inputs.map(newestMtime));
  return newest > built ? 'sources newer than output' : null;
}

if (import.meta.main) {
  // Lazy: the module is also imported by tests running under Node.
  const { $ } = await import('bun');
  for (const pkg of ENGINE_PACKAGES) {
    const reason = ifStale ? staleReason(pkg) : 'forced';
    if (!reason) {
      console.log(`✓ ${pkg.name} is up to date (${pkg.pkg})`);
      continue;
    }
    console.log(`▶ building ${pkg.name} → ${pkg.pkg} (${reason})`);
    // `--out-dir` is relative to the crate dir.
    await $`wasm-pack build --target web --out-dir pkg`.cwd(join(REPO_ROOT, pkg.crate));
  }
}
