// @vitest-environment node
/**
 * Plan P3.3: the AssemblyScript built-ins match the former Rust effects.
 *
 * `goldens.json` files were generated from the old implementation
 * (rs-engine/core/src/legacy_goldens.rs) before it was deleted. `raw` cases
 * compare the plugin output directly; `mapped` cases compare the final value
 * after the host's bipolar mapping v = base + strength × (out − 1) / 2.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIGNATURE_ARITY, type Signature } from '@pixelmapper/extension-api';
import {
  buildPackage,
  CTX,
  CTX_FIELDS,
  encodeParams,
  PluginInstance,
  SAMPLE,
  SAMPLE_FIELDS,
  validate,
  type ContentPluginManifest,
} from '@pixelmapper/plugin-toolchain';

/** One golden case. */
interface GoldenCase {
  params: Record<string, never>;
  ctx: { timeMs: number; beatTime: number; bpm: number; phaseSpeed: number; strength: number };
  samples: { x: number; y: number; phase: number; groupIndex?: number; groupCount?: number; base: number[]; channelSeed?: number }[];
  expected: number[][];
  compare: 'raw' | 'mapped';
}

const TOLERANCE = 1e-3;
const PLUGINS = ['waveform', 'noise', 'sequencer', 'color-adjust'];

/** Loads a plugin folder. */
function load(name: string) {
  const dir = join(import.meta.dirname, name);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ContentPluginManifest;
  const source = readFileSync(join(dir, 'modifier.ts'), 'utf8');
  const goldens = JSON.parse(readFileSync(join(dir, 'goldens.json'), 'utf8')) as { cases: GoldenCase[] };
  return { manifest, source, goldens };
}

describe.each(PLUGINS)('built-in plugin %s', (name) => {
  it('builds and passes the validation harness', async () => {
    const { manifest, source } = load(name);
    const { pkg, diagnostics } = await buildPackage(manifest, { 'modifier.ts': source });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const report = await validate({ manifest, wasm: pkg!.wasm }, { skipPerf: true });
    expect(report.errors).toEqual([]);
  }, 120_000);

  it('matches the former Rust implementation (goldens)', async () => {
    const { manifest, source, goldens } = load(name);
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': source });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    const arity = SIGNATURE_ARITY[manifest.signatures[0] as Signature];
    const failures: string[] = [];

    goldens.cases.forEach((c, ci) => {
      inst.prepare(encodeParams(manifest.params, c.params));
      const ctx = new Float32Array(CTX_FIELDS);
      ctx[CTX.timeMs] = c.ctx.timeMs;
      ctx[CTX.beatTime] = c.ctx.beatTime;
      ctx[CTX.bpm] = c.ctx.bpm;
      ctx[CTX.phaseSpeed] = c.ctx.phaseSpeed;
      ctx[CTX.arity] = arity;
      ctx[CTX.strength] = c.ctx.strength;
      const samples = new Float32Array(c.samples.length * SAMPLE_FIELDS);
      c.samples.forEach((s, i) => {
        const o = i * SAMPLE_FIELDS;
        samples[o + SAMPLE.x] = s.x;
        samples[o + SAMPLE.y] = s.y;
        samples[o + SAMPLE.phase] = s.phase;
        samples[o + SAMPLE.groupIndex] = s.groupIndex ?? 0;
        samples[o + SAMPLE.groupCount] = s.groupCount ?? 1;
        s.base.forEach((b, k) => { samples[o + SAMPLE.base0 + k] = b; });
        const seed = s.channelSeed ?? 0;
        samples[o + SAMPLE.channelSeedLo] = seed & 0xffff;
        samples[o + SAMPLE.channelSeedHi] = seed >>> 16;
      });
      const out = inst.render(ctx, samples, c.samples.length);

      c.samples.forEach((s, i) => {
        for (let k = 0; k < arity; k++) {
          const raw = out[i * arity + k]!;
          const got = c.compare === 'mapped' ? s.base[0]! + c.ctx.strength * (raw - 1) / 2 : raw;
          const want = c.expected[i]![k]!;
          if (!(Math.abs(got - want) <= TOLERANCE)) {
            failures.push(`case ${ci} ${JSON.stringify(c.params)} sample ${i} [${k}]: got ${got}, want ${want}`);
          }
        }
      });
    });

    expect(failures.slice(0, 10)).toEqual([]);
  }, 120_000);
});
