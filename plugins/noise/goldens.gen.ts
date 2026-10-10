/**
 * Generates `goldens.json` for Noise (plan M9.6): every recipe on the
 * reference rig at 8 times (seeded samples). Recipes without coherence are
 * computed by a TS reference of the plugin math; coherent recipes (Perlin
 * texture) are snapshots of the compiled plugin, checked for range and
 * smoothness by `noise-properties.test.ts`.
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
  const [mode, rmin, rmax, rate, lenRaw, dir, coh, sync, hard, count] = Array.from(b.slice(0, 10));
  const len = Math.max(lenRaw!, 0.02);
  const samples = rig.samples.map(s => ({ x: s.x, y: s.y, phase: 0, base: [1], spatial: s.spatial, rank: s.rank, distGroup: s.distGroup, headIndex: s.head, headCount: s.headCount, seed: rigSeed(s.fixture, s.head), groupIndex: s.fixture, groupCount: 8 }));

  /** TS reference of the level path (no coherence, no color variation). */
  const level = (seed: number, r: number) => {
    const j = hash01(seed, 1) * (1 - sync!);
    const t = r + j;
    const kf = Math.floor(t);
    const f = t - kf;
    const w = 1 - hard!;
    const a = hash01(seed, kf * 2 + 7);
    let v = f < 1 - w ? a : lerp(a, hash01(seed, (kf + 1) * 2 + 7), smooth((f - (1 - w)) / Math.max(w, 1e-3)));
    if (rate! > 0) {
      const e = Math.floor(r / len);
      if (hash01(seed, e * 3 + 101) < rate! * len) {
        const local = r / len - e;
        const pulse = local < 0.1 ? local / 0.1 : 1 - (local - 0.1) / 0.9;
        v = Math.round(dir!) === 0 ? Math.max(v, pulse) : v * (1 - pulse);
      }
    }
    return Math.max(0, Math.min(1, rmin! + (rmax! - rmin!) * v));
  };
  /** TS reference of the pick path. */
  const picked = (k: number, rank: number, ranks: number, n: number) => {
    const key = hash01((INSTANCE_SEED ^ Math.imul(k, 0x9e3779b9)) >>> 0, rank);
    let below = 0;
    for (let i = 0; i < ranks; i++) if (hash01((INSTANCE_SEED ^ Math.imul(k, 0x9e3779b9)) >>> 0, i) < key) below++;
    return below < n ? 1 : 0;
  };

  return Array.from({ length: 8 }, (_, i) => i * 0.37 + 0.05).map((tp) => {
    const ctx = { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp, rankCount: rig.rankCount, distGroupCount: rig.distGroupCount, ticks: rig.ticks, seed: INSTANCE_SEED };
    let expected: number[][];
    if (Math.round(mode!) === 1) {
      const ranks = rig.rankCount;
      const n = count! > 0 ? count! : Math.ceil(ranks / 3);
      const kf = Math.floor(tp);
      const f = tp - kf;
      const w = 1 - hard!;
      expected = rig.samples.map((s) => {
        let v = picked(kf, s.rank, ranks, n);
        if (w > 0 && f > 1 - w) v = lerp(v, picked(kf + 1, s.rank, ranks, n), smooth((f - (1 - w)) / w));
        return [v];
      });
    }
    else if (coh! > 0 || b[10]! > 0) {
      // Snapshot of the compiled plugin (Perlin texture / color variation).
      plugin.prepare(b);
      const c = new Float32Array(CTX_FIELDS);
      c[CTX.arity] = 1; c[CTX.timePhase] = tp; c[CTX.rankCount] = ctx.rankCount; c[CTX.seedLo] = INSTANCE_SEED & 0xffff; c[CTX.seedHi] = INSTANCE_SEED >>> 16;
      const buf = new Float32Array(samples.length * SAMPLE_FIELDS);
      samples.forEach((s, k) => {
        const o = k * SAMPLE_FIELDS;
        buf[o + SAMPLE.x] = s.x; buf[o + SAMPLE.y] = s.y; buf[o + SAMPLE.spatial] = s.spatial; buf[o + SAMPLE.rank] = s.rank;
        buf[o + SAMPLE.distGroup] = s.distGroup; buf[o + SAMPLE.seed] = s.seed; buf[o + SAMPLE.base0] = 1;
        buf[o + SAMPLE.headIndex] = s.headIndex; buf[o + SAMPLE.headCount] = s.headCount; buf[o + SAMPLE.groupIndex] = s.groupIndex; buf[o + SAMPLE.groupCount] = s.groupCount;
      });
      expected = Array.from(plugin.render(c, buf, samples.length), v => [v]);
    }
    else expected = rig.samples.map((s, k) => [level(samples[k]!.seed, tp)]);
    return { name: `${preset.id} @ ${tp.toFixed(3)}`, compare: 'raw', params, ctx, samples, expected };
  });
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[noise goldens] ${cases.length} cases`);
