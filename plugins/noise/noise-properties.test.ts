// @vitest-environment node
/**
 * Noise goldens properties (plan M9.6, review): levels stay inside their
 * range and vary across fixtures; Frequency sets how much of the time it is
 * bright (Lightning mostly dark, Faulty mostly bright); All the same gives
 * the whole rig one value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const goldens = JSON.parse(readFileSync(join(import.meta.dirname, 'goldens.json'), 'utf8')) as {
  cases: { name: string; params: Record<string, number | string>; ctx: { spread?: number }; expected: number[][] }[];
};

describe('noise golden properties', () => {
  it('levels stay in [rangeMin, rangeMax] and differ between fixtures', () => {
    for (const c of goldens.cases) {
      const vals = c.expected.map(e => e[0]!);
      for (const v of vals) {
        expect(v).toBeGreaterThanOrEqual(Number(c.params.rangeMin) - 1e-4);
        expect(v).toBeLessThanOrEqual(Number(c.params.rangeMax) + 1e-4);
      }
      if (Number(c.params.rangeMax) - Number(c.params.rangeMin) > 0.2 && c.ctx.spread !== 0 && Math.abs(Number(c.params.frequency) - 0.5) < 0.2) expect(Math.max(...vals) - Math.min(...vals), c.name).toBeGreaterThan(0.02);
    }
  });

  it('Frequency: the mean level follows it (low = mostly dark, high = mostly bright)', () => {
    const mean = (id: string) => {
      const vals = goldens.cases.filter(c => c.name.startsWith(`${id} `)).flatMap(c => c.expected.map(e => e[0]!));
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    expect(mean('random-pick')).toBeLessThan(0.35);
    expect(mean('faulty')).toBeGreaterThan(0.8);
  });

  it('All the same: the whole rig shares one value', () => {
    const cases = goldens.cases.filter(c => c.ctx.spread === 0);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const vals = c.expected.map(e => e[0]!);
      expect(Math.max(...vals) - Math.min(...vals), c.name).toBeLessThan(1e-6);
    }
  });
});

describe('noise frequency and variation (compiled plugin)', () => {
  it('Frequency is the share above half; Variation 0 is on/off (high / low), 1 soft levels', async () => {
    const { buildPackage, CTX, CTX_FIELDS, encodeParams, PluginInstance, SAMPLE, SAMPLE_FIELDS } = await import('@pixelmapper/plugin-toolchain');
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'manifest.json'), 'utf8'));
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': readFileSync(join(import.meta.dirname, 'modifier.ts'), 'utf8') });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    const N = 400;
    /** Levels of N pixels at one moment (range 0.2–0.9, hard steps). */
    const render = (frequency: number, variation: number) => {
      inst.prepare(encodeParams(manifest.params, { rangeMin: 0.2, rangeMax: 0.9, frequency, variation, hardness: 1 }, { ticks: 8 }));
      const ctx = new Float32Array(CTX_FIELDS);
      ctx[CTX.arity] = 1; ctx[CTX.timePhase] = 3.3; ctx[CTX.spread] = 1; ctx[CTX.seedLo] = 0x1234;
      const samples = new Float32Array(N * SAMPLE_FIELDS);
      for (let i = 0; i < N; i++) { samples[i * SAMPLE_FIELDS + SAMPLE.seed] = 1000 + i * 7919; samples[i * SAMPLE_FIELDS + SAMPLE.spatial] = i / N; }
      return Array.from(inst.render(ctx, samples, N));
    };
    const onOff = render(0.25, 0);
    for (const v of onOff) expect(Math.min(Math.abs(v - 0.2), Math.abs(v - 0.9))).toBeLessThan(1e-4);
    const share = onOff.filter(v => v > 0.55).length / N;
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.32);
    const soft = render(0.25, 1);
    expect(soft.filter(v => v > 0.21 && v < 0.89).length).toBeGreaterThan(N / 2);
    expect(soft.filter(v => v > 0.55).length / N).toBeCloseTo(share, 1);
  }, 120_000);
});
