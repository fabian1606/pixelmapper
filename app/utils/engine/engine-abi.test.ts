// @vitest-environment node
/**
 * Host ↔ engine handshake: the TS and Rust ABI constants agree, mismatched
 * or incomplete builds are rejected, and the current `rs-engine/core/pkg`
 * build (when present) passes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enginePkgDir, REPO_ROOT } from '~~/scripts/engine-packages';
import { checkEngineModules, ENGINE_ABI_VERSION, REQUIRED_CANVAS_METHODS, REQUIRED_ENGINE_METHODS } from './engine-abi';

/** A fake wasm-bindgen class with the given methods. */
function fakeClass(methods: readonly string[]): unknown {
  class Fake {}
  for (const m of methods) (Fake.prototype as unknown as Record<string, unknown>)[m] = () => {};
  return Fake;
}

/** A fake core module with the given ABI version (null = no export). */
function fakeCore(abi: number | null, methods: readonly string[] = REQUIRED_ENGINE_METHODS): Record<string, unknown> {
  return {
    WasmEngine: fakeClass(methods),
    ...(abi === null ? {} : { engine_abi_version: () => abi }),
  };
}

const fakeCanvas = { WasmCanvas: fakeClass(REQUIRED_CANVAS_METHODS) };

describe('engine ABI handshake', () => {
  it('matches ENGINE_ABI_VERSION in rs-engine/core/src/lib.rs', () => {
    const lib = readFileSync(join(REPO_ROOT, 'rs-engine/core/src/lib.rs'), 'utf8');
    const rust = Number(/pub const ENGINE_ABI_VERSION: u32 = (\d+);/.exec(lib)?.[1]);
    expect(rust).toBe(ENGINE_ABI_VERSION);
  });

  it('accepts a matching build', () => {
    expect(checkEngineModules(fakeCore(ENGINE_ABI_VERSION), fakeCanvas)).toBeNull();
  });

  it('rejects a build without ABI version (predates the handshake)', () => {
    expect(checkEngineModules(fakeCore(null), fakeCanvas)).toMatch(/no ABI version/);
  });

  it('rejects another ABI version', () => {
    expect(checkEngineModules(fakeCore(ENGINE_ABI_VERSION + 1), fakeCanvas)).toMatch(/ABI \d+, app expects/);
  });

  it('names missing engine and canvas methods', () => {
    const core = fakeCore(ENGINE_ABI_VERSION, REQUIRED_ENGINE_METHODS.filter(m => m !== 'read_head_signatures'));
    const canvas = { WasmCanvas: fakeClass(REQUIRED_CANVAS_METHODS.filter(m => m !== 'draw')) };
    const msg = checkEngineModules(core, canvas);
    expect(msg).toMatch(/WasmEngine lacks read_head_signatures/);
    expect(msg).toMatch(/WasmCanvas lacks draw/);
  });

  const core = enginePkgDir('rs-engine-core');
  it.skipIf(!existsSync(join(core, 'rs_engine_core_bg.wasm')))('accepts the built rs-engine/core/pkg', async () => {
    const mod = await import(join(core, 'rs_engine_core.js'));
    await mod.default({ module_or_path: readFileSync(join(core, 'rs_engine_core_bg.wasm')) });
    expect(checkEngineModules(mod)).toBeNull();
  });
});
