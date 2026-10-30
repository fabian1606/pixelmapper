// @vitest-environment node
/**
 * Engine package locations: built outside node_modules (`bun install` wipes
 * unknown dirs there), resolved by alias only, and modules from a parent
 * checkout's node_modules are refused.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { staleReason } from './build-wasm';
import { ENGINE_PACKAGES, enginePackageAliases } from './engine-packages';
import { isForeignNodeModule } from './vite-project-guard';
import pkg from '../package.json';

describe('engine package paths', () => {
  it('aliases both packages to rs-engine/*/pkg inside the repo', () => {
    const aliases = enginePackageAliases('/repo');
    expect(aliases).toEqual({
      'rs-engine-core': '/repo/rs-engine/core/pkg',
      'rs-engine-canvas': '/repo/rs-engine/canvas/pkg',
    });
  });

  it('package.json neither depends on nor builds into node_modules/rs-engine-*', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    for (const p of ENGINE_PACKAGES) expect(deps[p.name]).toBeUndefined();
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(script, name).not.toMatch(/node_modules\/rs-engine/);
    }
  });

  it('app start and builds ensure a current engine build', () => {
    for (const name of ['dev', 'dev:nuxt', 'build', 'generate'] as const) {
      expect(pkg.scripts[name], name).toMatch(/ensure:wasm/);
    }
  });
});

describe('project node_modules guard', () => {
  const root = '/a/pixelmapper/.claude/worktrees/x';
  it('refuses a parent checkout\'s node_modules', () => {
    expect(isForeignNodeModule('/a/pixelmapper/node_modules/rs-engine-core/rs_engine_core.js', root)).toBe(true);
    expect(isForeignNodeModule('/a/pixelmapper/node_modules/vue/index.mjs?v=1', root)).toBe(true);
  });

  it('allows own node_modules, sources and virtual ids', () => {
    expect(isForeignNodeModule(`${root}/node_modules/vue/index.mjs`, root)).toBe(false);
    expect(isForeignNodeModule(`${root}/rs-engine/core/pkg/rs_engine_core.js`, root)).toBe(false);
    expect(isForeignNodeModule('\0virtual:nuxt', root)).toBe(false);
    expect(isForeignNodeModule('/a/pixelmapper/app/app.vue', root)).toBe(false);
  });
});

describe('build-wasm --if-stale', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  /** A fake repo with the core crate; `built` writes the pkg output. */
  function fakeRepo(built: boolean): string {
    dir = mkdtempSync(join(tmpdir(), 'pm-wasm-'));
    mkdirSync(join(dir, 'rs-engine/core/src'), { recursive: true });
    writeFileSync(join(dir, 'rs-engine/core/src/lib.rs'), '');
    writeFileSync(join(dir, 'rs-engine/core/Cargo.toml'), '');
    if (built) {
      mkdirSync(join(dir, 'rs-engine/core/pkg'));
      writeFileSync(join(dir, 'rs-engine/core/pkg/package.json'), '{}');
      writeFileSync(join(dir, 'rs-engine/core/pkg/rs_engine_core_bg.wasm'), '');
    }
    return dir;
  }
  const core = ENGINE_PACKAGES.find(p => p.name === 'rs-engine-core')!;

  it('builds when the output is missing', () => {
    expect(staleReason(core, fakeRepo(false))).toBe('output missing');
  });

  it('skips a current build and rebuilds after a source change', () => {
    const root = fakeRepo(true);
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(root, 'rs-engine/core/src/lib.rs'), past, past);
    utimesSync(join(root, 'rs-engine/core/Cargo.toml'), past, past);
    expect(staleReason(core, root)).toBeNull();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'rs-engine/core/src/lib.rs'), future, future);
    expect(staleReason(core, root)).toBe('sources newer than output');
  });
});
