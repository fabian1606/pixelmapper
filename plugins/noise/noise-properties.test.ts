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

describe('noise coherence texture (compiled plugin)', () => {
  const G = 48;
  /** Renders a G×G stage grid (Spatial 2D, linear handle) at time phase tp. */
  async function texture() {
    const { buildPackage, CTX, CTX_FIELDS, encodeParams, PluginInstance, SAMPLE, SAMPLE_FIELDS } = await import('@pixelmapper/plugin-toolchain');
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'manifest.json'), 'utf8'));
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': readFileSync(join(import.meta.dirname, 'modifier.ts'), 'utf8') });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    inst.prepare(encodeParams(manifest.params, { rangeMin: 0, rangeMax: 1, coherence: 1, hardness: 0 }, { ticks: 8 }));
    return (tp: number, handle: [number, number, number, number], shift = { x: 0, y: 0 }) => {
      const ctx = new Float32Array(CTX_FIELDS);
      ctx[CTX.arity] = 1; ctx[CTX.timePhase] = tp; ctx[CTX.spread] = 1; ctx[CTX.seedLo] = 0x1234;
      [ctx[CTX.handleOriginX], ctx[CTX.handleOriginY], ctx[CTX.handleEndX], ctx[CTX.handleEndY]] = handle;
      const [ox, oy, ex, ey] = handle;
      const len2 = (ex - ox) ** 2 + (ey - oy) ** 2;
      const samples = new Float32Array(G * G * SAMPLE_FIELDS);
      for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
          const o = (j * G + i) * SAMPLE_FIELDS;
          const x = i / G + shift.x;
          const y = j / G + shift.y;
          samples[o + SAMPLE.x] = x; samples[o + SAMPLE.y] = y; samples[o + SAMPLE.seed] = j * G + i;
          samples[o + SAMPLE.spatial] = ((x - ox) * (ex - ox) + (y - oy) * (ey - oy)) / len2;
        }
      }
      return inst.render(ctx, samples, G * G);
    };
  }
  /** Mean neighbour difference along x and y. */
  const roughness = (v: Float32Array) => {
    let dx = 0;
    let dy = 0;
    for (let j = 0; j < G - 1; j++) {
      for (let i = 0; i < G - 1; i++) {
        dx += Math.abs(v[j * G + i + 1]! - v[j * G + i]!);
        dy += Math.abs(v[(j + 1) * G + i]! - v[j * G + i]!);
      }
    }
    return { dx, dy };
  };
  const mad = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;

  it('is even in all directions (no bands across the handle)', async () => {
    const render = await texture();
    let dx = 0;
    let dy = 0;
    for (const tp of [0.3, 1.7, 2.45, 5.1]) {
      const r = roughness(render(tp, [0, 0.5, 0.5, 0.5]));
      dx += r.dx;
      dy += r.dy;
    }
    expect(dx / dy).toBeGreaterThan(0.8);
    expect(dx / dy).toBeLessThan(1.25);
  }, 120_000);

  it('a shorter handle makes smaller patches', async () => {
    const render = await texture();
    const big = roughness(render(1.3, [0, 0.5, 0.5, 0.5]));
    const small = roughness(render(1.3, [0, 0.5, 0.2, 0.5]));
    expect(small.dx + small.dy).toBeGreaterThan(1.8 * (big.dx + big.dy));
  }, 120_000);

  it('patches drift in the handle direction', async () => {
    const render = await texture();
    const handle: [number, number, number, number] = [0, 0.5, 0.5, 0.5];
    // Half a patch per step: base patch = 1/2.5 of 0.5 handle units → 0.2 stage units per step along +x.
    const later = render(1.5, handle);
    const along = mad(render(1, handle, { x: -0.1, y: 0 }), later);
    const across = mad(render(1, handle, { x: 0, y: -0.1 }), later);
    expect(along).toBeLessThan(0.6 * across);
  }, 120_000);
});
