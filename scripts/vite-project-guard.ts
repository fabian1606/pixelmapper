/**
 * Vite plugin: refuses modules that resolve into a `node_modules` outside
 * this checkout.
 *
 * Bare imports follow Node resolution, which walks up the directory tree.
 * Git worktrees of this repo live inside it (`.claude/worktrees/<name>`), so
 * a package missing from the worktree's own `node_modules` silently loaded
 * from the main checkout's — e.g. an older engine build without the exports
 * the app needs, rendering black. Failing at load time turns that into a
 * clear "run bun install" error instead.
 */
import type { Plugin } from 'vite';

/** True when `id` is a file inside a node_modules dir that is not below `root`. */
export function isForeignNodeModule(id: string, root: string): boolean {
  const file = id.split('?')[0]!.replace(/\\/g, '/');
  if (!file.startsWith('/') && !/^[A-Za-z]:\//.test(file)) return false; // virtual / relative ids
  if (!file.includes('/node_modules/')) return false;
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  return !file.startsWith(`${base}/`);
}

/** The guard plugin for the checkout at `root`. */
export function projectNodeModulesGuard(root: string): Plugin {
  return {
    name: 'pixelmapper:project-node-modules-guard',
    enforce: 'pre',
    load(id) {
      if (!isForeignNodeModule(id, root)) return null;
      this.error(
        `[pixelmapper] ${id} resolved outside this checkout (${root}). `
        + 'A dependency is missing from this checkout\'s node_modules — run `bun install` here.',
      );
    },
  };
}
