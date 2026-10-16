// @vitest-environment node
/**
 * Plan P3.2: toolchain compile/instrument/validate/hash and rejection fixtures.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPackage,
  canonicalManifest,
  compile,
  encodeParams,
  hashPackage,
  instrument,
  PluginInstance,
  PluginTrap,
  transpileUi,
  validate,
  validateManifest,
  verifyPackage,
  type ContentPluginManifest,
} from './index';

/** Minimal valid manifest. */
function manifest(overrides: Partial<ContentPluginManifest> = {}): ContentPluginManifest {
  return {
    schema: 1,
    kind: 'modifier',
    alias: '@test/pulse',
    name: 'Pulse',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    description: 'A sine pulse over the modifier phase.',
    signatures: ['scalar'],
    output: 'bipolar',
    params: [{ key: 'amount', type: 'number', min: 0, max: 1, default: 1, label: 'Amount' }],
    ...overrides,
  };
}

/** Wraps a render body into a modifier module. */
const mod = (render: string, extra = '') => `
import { Modifier, Frame, Sample, Out, Params, register, TAU } from "@pixelmapper/plugin-sdk";
${extra}
class M extends Modifier {
  amount: f32 = 1;
  prepare(p: Params): void { this.amount = p.get(0); }
  render(ctx: Frame, s: Sample, out: Out): void { ${render} }
}
register(new M());
`;

const GOOD = mod('out.set(0, Mathf.sin(s.phase * TAU) * this.amount);');

/** Builds and validates a plugin source. */
async function check(source: string, m = manifest()) {
  const { pkg, diagnostics } = await buildPackage(m, { 'modifier.ts': source });
  expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  return validate({ manifest: m, wasm: pkg!.wasm }, { frames: 125, skipPerf: true });
}

describe('compile + instrument', () => {
  it('compiles a plugin and injects the budget import', async () => {
    const { wasm, diagnostics } = await compile({ files: { 'modifier.ts': GOOD } });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const { wasm: inst, functions } = instrument(wasm!);
    expect(functions).toBeGreaterThan(0);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(new Uint8Array(inst))).map(i => `${i.module}.${i.name}`);
    expect(imports.sort()).toEqual(['env.abort', 'env.memory', 'pm.budget']);
  }, 60_000);

  it('reports compile errors as diagnostics', async () => {
    const { wasm, diagnostics } = await compile({ files: { 'modifier.ts': mod('out.set(0, undefinedThing);') } });
    expect(wasm).toBeNull();
    expect(diagnostics.some(d => d.severity === 'error' && d.message.includes('undefinedThing'))).toBe(true);
  }, 60_000);

  it('renders through the runtime', async () => {
    const { pkg } = await buildPackage(manifest(), { 'modifier.ts': GOOD });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    inst.prepare(encodeParams(manifest().params, { amount: 0.5 }));
    const ctx = new Float32Array(16);
    ctx[4] = 1;
    const samples = new Float32Array(32);
    samples[2] = 0.25; // phase → sin(π/2) = 1
    samples[16 + 2] = 0.75;
    const out = inst.render(ctx, samples, 2);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(-0.5);
  }, 60_000);
});

describe('validation harness', () => {
  it('accepts a good plugin', async () => {
    const r = await check(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.metrics.samples).toBe(288);
  }, 60_000);

  it('rejects an infinite loop via the budget trap', async () => {
    const r = await check(mod('let i: i32 = 0; while (s.x >= 0.0) { i++; } out.set(0, <f32>i);'));
    expect(r.errors[0]).toMatch(/iteration budget exceeded/);
  }, 60_000);

  it('rejects NaN output', async () => {
    const r = await check(mod('out.set(0, NaN);'));
    expect(r.errors[0]).toMatch(/non-finite output NaN/);
  }, 60_000);

  it('rejects out-of-range output', async () => {
    const r = await check(mod('out.set(0, 5.0);'));
    expect(r.errors[0]).toMatch(/outside \[-2, 2\]/);
  }, 60_000);

  it('rejects absolute output outside [0, 1]', async () => {
    const r = await check(mod('out.set(0, -0.5);'), manifest({ output: 'absolute' }));
    expect(r.errors[0]).toMatch(/outside \[0, 1\]/);
  }, 60_000);

  it('rejects scale output outside [0, 1] (A20)', async () => {
    const r = await check(mod('out.set(0, 1.5);'), manifest({ output: 'scale' }));
    expect(r.errors[0]).toMatch(/outside \[0, 1\] for "scale"/);
  }, 60_000);

  it('rejects forbidden imports', async () => {
    const src = mod('evil(); out.set(0, 0.0);', '@external("env", "evil") declare function evil(): void;');
    const { pkg } = await buildPackage(manifest(), { 'modifier.ts': src });
    const r = await validate({ manifest: manifest(), wasm: pkg!.wasm }, { frames: 5, skipPerf: true });
    expect(r.errors[0]).toMatch(/forbidden imports: env.evil/);
  }, 60_000);

  it('rejects state across frames (non-determinism)', async () => {
    const r = await check(mod('counter++; out.set(0, <f32>(counter % 7) * 0.25);', 'let counter: i32 = 0;'));
    expect(r.errors.some(e => /non-deterministic/.test(e))).toBe(true);
  }, 60_000);

  it('rejects uninstrumented modules', async () => {
    const { wasm } = await compile({ files: { 'modifier.ts': GOOD } });
    const r = await validate({ manifest: manifest(), wasm: wasm! }, { frames: 2, skipPerf: true });
    expect(r.errors).toContain('module is not instrumented (missing pm.budget import)');
  }, 60_000);

  it('warns on constant output', async () => {
    const r = await check(mod('out.set(0, 0.25);'));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/constant/);
  }, 60_000);

  it('turns an abort into a PluginTrap', async () => {
    const { pkg } = await buildPackage(manifest(), { 'modifier.ts': mod('if (s.x >= 0.0) abort("boom"); out.set(0, 0.0);') });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    const ctx = new Float32Array(16);
    ctx[4] = 1;
    expect(() => inst.render(ctx, new Float32Array(16), 1)).toThrow(PluginTrap);
  }, 60_000);
});

describe('manifest, params, hash, ui', () => {
  it('validates manifests with readable errors', () => {
    expect(validateManifest(manifest()).ok).toBe(true);
    const bad = validateManifest({ ...manifest(), alias: 'pulse', signatures: ['hsv'], params: [{ key: 'Amount', type: 'number', min: 1, max: 0, default: 0, label: '' }] });
    expect(bad.errors).toEqual(expect.arrayContaining([
      'alias must look like "@scope/name" (kebab-case)',
      'unknown signature "hsv"',
      'params[0] "Amount": key must be camelCase',
      'params[0] "Amount": needs numeric min < max',
    ]));
  });

  it('encodes params into the f32 block in manifest order', () => {
    const block = encodeParams([
      { key: 'a', type: 'number', min: 0, max: 1, default: 0.5, label: 'A' },
      { key: 'b', type: 'enum', options: ['x', 'y', 'z'], default: 'x', label: 'B' },
      { key: 'c', type: 'color', default: { r: 1, g: 0, b: 0 }, label: 'C' },
      { key: 'd', type: 'bool', default: false, label: 'D' },
      { key: 'e', type: 'curve', default: [{ x: 0, y: 0 }, { x: 1, y: 1 }], label: 'E' },
    ], { b: 'z', d: true });
    expect(block.length).toBe(1 + 1 + 3 + 1 + 128);
    expect([...block.slice(0, 6)]).toEqual([0.5, 2, 1, 0, 0, 1]);
    expect(block[6]).toBe(0);
    expect(block[6 + 127]).toBeCloseTo(1);
  });

  it('hashes canonically (key order independent, hash field ignored)', async () => {
    const wasm = new Uint8Array([0, 97, 115, 109]);
    const a = manifest();
    const b = JSON.parse(JSON.stringify({ hash: 'x', ...Object.fromEntries(Object.entries(a).reverse()) }));
    expect(canonicalManifest(b)).toBe(canonicalManifest(a));
    expect(await hashPackage(a, wasm)).toBe(await hashPackage(b, wasm));
    expect(await hashPackage(a, wasm)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await hashPackage(a, wasm, 'x')).not.toBe(await hashPackage(a, wasm));
  });

  it('transpiles ui.ts and rejects imports', () => {
    expect(transpileUi('export function mount(el: HTMLElement, api: unknown): () => void { return () => {}; }').js)
      .toContain('export function mount(el, api)');
    expect(transpileUi('import x from "y";\nexport function mount() {}').errors).toContain('ui.ts must not use import statements');
    expect(transpileUi('const a = 1;').errors).toContain('ui.ts must export a function mount(el, api)');
  });

  it('builds deterministically and verifies by recompiling', async () => {
    const { pkg } = await buildPackage(manifest(), { 'modifier.ts': GOOD });
    expect((await verifyPackage(pkg!)).ok).toBe(true);
    expect((await verifyPackage({ ...pkg!, source: { 'modifier.ts': GOOD.replace('* this.amount', '* this.amount * 0.5') } })).error).toMatch(/hash mismatch/);
    expect((await verifyPackage({ ...pkg!, source: {} })).error).toMatch(/binary-only/);
  }, 60_000);
});
