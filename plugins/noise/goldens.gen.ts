/**
 * Generates `goldens.json` for Noise (plan M9.6, review): every recipe on the
 * reference rig at 8 times (seeded samples). Recipes without coherence or
 * color variation are computed by a TS reference of the plugin math (keys by
 * spread, peaks, exact pick); the others are snapshots of the compiled
 * plugin, checked for range and sharing by `noise-properties.test.ts`.
 * Run: `bun run plugins/noise/goldens.gen.ts`
 */
import { buildPackage, CTX, CTX_FIELDS, encodeParams, PluginInstance, SAMPLE, SAMPLE_FIELDS } from '@pixelmapper/plugin-toolchain';
import { presetParams } from '../../app/utils/engine/recipes';
import { hash01, isMultiHead, loadManifest, rigSamples, rigSeed } from '../_golden/reference';

const INSTANCE_SEED = 0x1234abcd;
const manifest = await loadManifest(import.meta.dir);
const { pkg } = await buildPackage(manifest, { 'modifier.ts': await Bun.file(`${import.meta.dir}/modifier.ts`).text() });
const plugin = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const cases = (manifest.presets ?? []).flatMap((preset) => {
  const params = presetParams(manifest, preset);
  const rig = rigSamples(preset, isMultiHead(preset));
  const b = encodeParams(manifest.params, params, { ticks: rig.ticks });
  const [rmin, rmax, freq, lenRaw, dir, coh, sync, hard, cv] = Array.from(b.slice(0, 9));
  const len = Math.max(0.02, Math.min(1, lenRaw!));
  const samples = rig.samples.map(s => ({ x: s.x, y: s.y, phase: 0, base: [1], spatial: s.spatial, rank: s.rank, distGroup: s.distGroup, headIndex: s.head, headCount: s.headCount, seed: rigSeed(s.fixture, s.head), groupIndex: s.fixture, groupCount: 8 }));

  /** Who shares a value (ABI v1.2 spread): the rig, a number, or a pixel. */
  const keyOf = (seed: number, rank: number) => rig.spread === 0
    ? INSTANCE_SEED & 0xffffff
    : rig.spread === 2 && rank >= 0 ? Math.trunc(Math.fround(hash01(INSTANCE_SEED, rank + 977) * 16777215)) : seed;
  /** Exact pick of slot e (fixture by fixture). */
  const picked = (e: number, rank: number, ranks: number, n: number) => {
    const ps = (INSTANCE_SEED ^ Math.imul(e, 0x9e3779b9)) >>> 0;
    const mine = hash01(ps, rank);
    let below = 0;
    for (let i = 0; i < ranks; i++) if (hash01(ps, i) < mine) below++;
    return below < n;
  };
  /** TS reference (no coherence, no color variation). */
  const value = (seed: number, rank: number, r: number) => {
    const key = keyOf(seed, rank);
    const t = r + hash01(key, 1) * (1 - sync!);
    const kf = Math.floor(t);
    const f = t - kf;
    const w = 1 - hard!;
    const a = hash01(key, kf * 2 + 7);
    const st = f < 1 - w ? a : lerp(a, hash01(key, (kf + 1) * 2 + 7), smooth((f - (1 - w)) / Math.max(w, 1e-3)));
    let v = rmin! + (rmax! - rmin!) * st;
    if (freq! > 0) {
      const ef = Math.floor(t / len);
      const p = freq! * len;
      const ranks = rig.rankCount;
      const on = rig.spread === 2 && rank >= 0 && ranks * p >= 1 ? picked(ef, rank, ranks, Math.round(ranks * p)) : hash01(key, ef * 3 + 101) < p;
      if (on) {
        const local = t / len - ef;
        const attack = 0.1 * w;
        const decay = 0.9 * w;
        const pulse = local < attack ? local / attack : local > 1 - decay ? (1 - local) / decay : 1;
        v = Math.round(dir!) === 0 ? Math.max(v, pulse) : v * (1 - pulse);
      }
    }
    return Math.max(0, Math.min(1, v));
  };

  return Array.from({ length: 8 }, (_, i) => i * 0.37 + 0.05).map((tp) => {
    const ctx = { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp, rankCount: rig.rankCount, distGroupCount: rig.distGroupCount, spread: rig.spread, ticks: rig.ticks, seed: INSTANCE_SEED };
    let expected: number[][];
    if (coh! > 0 || cv! > 0) {
      // Snapshot of the compiled plugin (Perlin texture / color variation).
      plugin.prepare(b);
      const c = new Float32Array(CTX_FIELDS);
      c[CTX.arity] = 1; c[CTX.timePhase] = tp; c[CTX.rankCount] = ctx.rankCount; c[CTX.spread] = ctx.spread; c[CTX.seedLo] = INSTANCE_SEED & 0xffff; c[CTX.seedHi] = INSTANCE_SEED >>> 16;
      const buf = new Float32Array(samples.length * SAMPLE_FIELDS);
      samples.forEach((s, k) => {
        const o = k * SAMPLE_FIELDS;
        buf[o + SAMPLE.x] = s.x; buf[o + SAMPLE.y] = s.y; buf[o + SAMPLE.spatial] = s.spatial; buf[o + SAMPLE.rank] = s.rank;
        buf[o + SAMPLE.distGroup] = s.distGroup; buf[o + SAMPLE.seed] = s.seed; buf[o + SAMPLE.base0] = 1;
        buf[o + SAMPLE.headIndex] = s.headIndex; buf[o + SAMPLE.headCount] = s.headCount; buf[o + SAMPLE.groupIndex] = s.groupIndex; buf[o + SAMPLE.groupCount] = s.groupCount;
      });
      expected = Array.from(plugin.render(c, buf, samples.length), v => [v]);
    }
    else expected = rig.samples.map((s, k) => [value(samples[k]!.seed, s.rank, tp)]);
    return { name: `${preset.id} @ ${tp.toFixed(3)}`, compare: 'raw', params, ctx, samples, expected };
  });
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[noise goldens] ${cases.length} cases`);
