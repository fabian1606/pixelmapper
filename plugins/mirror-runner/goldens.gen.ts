/**
 * Generates `goldens.json` for Mirror Runner (plan M5 reference effect):
 * every recipe plus the other mirror axes and Reverse on 4 LED tubes × 8
 * pixels (two left, two right of the room center; the front pair at the
 * top) at 8 phases, computed by a TS reference of the plugin math.
 * Run: `bun run plugins/mirror-runner/goldens.gen.ts`
 */
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { presetParams } from '../../app/utils/engine/recipes';
import { loadManifest, PHASES } from '../_golden/reference';

const manifest = await loadManifest(import.meta.dir);

/** 4 vertical tubes × 8 pixels; u/v are the room coordinates (bounding box 0.2–0.8 × 0.3–0.7). */
const TUBES = [{ x: 0.2, y0: 0.3 }, { x: 0.4, y0: 0.3 }, { x: 0.6, y0: 0.5 }, { x: 0.8, y0: 0.5 }];
const HEADS = 8;
const RIG = TUBES.flatMap(t => Array.from({ length: HEADS }, (_, h) => {
  const y = t.y0 + 0.2 * h / (HEADS - 1);
  return { x: t.x, y, u: (t.x - 0.2) / 0.6, v: (y - 0.3) / 0.4, headIndex: h, headCount: HEADS };
}));

const fract = (t: number) => t - Math.floor(t);

/** Recipes plus variants that cover every mirror axis and Reverse. */
const variants = [
  ...(manifest.presets ?? []).map(preset => ({ id: preset.id, params: presetParams(manifest, preset) })),
  { id: 'front-back', params: { ...presetParams(manifest, manifest.presets![0]!), mirror: 'frontBack' } },
  { id: 'off-reverse', params: { ...presetParams(manifest, manifest.presets![0]!), mirror: 'off', reverse: true } },
];

const cases = variants.flatMap(({ id, params }) => {
  const p = encodeParams(manifest.params, params, {});
  const tailTime = Math.max(p[0]!, 0.001) * 0.5;
  const mirror = Math.round(p[1]!);
  const reverse = p[2]! >= 0.5;
  return PHASES.map((tp) => ({
    name: `${id} @ ${tp.toFixed(3)}`,
    compare: 'raw',
    params,
    ctx: { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp },
    samples: RIG.map(s => ({ x: s.x, y: s.y, u: s.u, v: s.v, phase: 0, base: [1], headIndex: s.headIndex, headCount: s.headCount })),
    expected: RIG.map((s) => {
      let pos = (s.headIndex + 0.5) / s.headCount;
      let flip = reverse;
      if (mirror === 0 && Math.fround(s.u) > 0.5) flip = !flip;
      else if (mirror === 1 && Math.fround(s.v) > 0.5) flip = !flip;
      if (flip) pos = 1 - pos;
      const f = fract(tp);
      const rise = pos * 0.5;
      const fall = 1 - rise;
      const since = f >= fall ? f - fall : f >= rise ? f - rise : f + rise;
      const v = since < tailTime ? 1 - since / tailTime : 0;
      return [v * v];
    }),
  }));
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[mirror-runner goldens] ${cases.length} cases`);
