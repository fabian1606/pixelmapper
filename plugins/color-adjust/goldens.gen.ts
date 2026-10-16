/**
 * Generates `goldens.json` for Color Shift (plan M7.7): every recipe on the
 * reference rig at 8 phases over an orange base color, computed by a TS
 * reference of the plugin math. Run: `bun run plugins/color-adjust/goldens.gen.ts`
 */
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { presetParams } from '../../app/utils/engine/recipes';
import { hslToRgb, isMultiHead, loadManifest, PHASES, rgbToHsl, rigSamples, sampleGradient, sampleLut, sampleSignedLut } from '../_golden/reference';

const BASE: [number, number, number] = [1, 0.35, 0];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const fract = (v: number) => v - Math.floor(v);

const manifest = await loadManifest(import.meta.dir);
const cases = (manifest.presets ?? []).flatMap((preset) => {
  const params = presetParams(manifest, preset);
  const rig = rigSamples(preset, isMultiHead(preset));
  const b = encodeParams(manifest.params, params, { ticks: rig.ticks });
  const palette = b[0] === 0;
  const alternate = Math.round(b[34]!) === 1;
  return PHASES.map((tp) => {
    const m = sampleLut(b, 168, fract(tp));
    return {
      name: `${preset.id} @ ${tp.toFixed(3)}`,
      compare: 'raw',
      params,
      ctx: { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp, rankCount: rig.rankCount, distGroupCount: rig.distGroupCount, spread: rig.spread, ticks: rig.ticks },
      samples: rig.samples.map(s => ({ x: s.x, y: s.y, phase: tp - s.spatial, base: BASE, spatial: s.spatial, rank: s.rank, distGroup: s.distGroup, headIndex: s.head, headCount: s.headCount })),
      expected: rig.samples.map((s) => {
        if (palette) {
          const n = Math.max(1, Math.min(8, Math.trunc(b[1]!)));
          let rgb: number[];
          if (alternate && s.rank >= 0) {
            const i = (s.rank + Math.floor(m * n)) % n;
            rgb = [0, 1, 2].map(c => b[1 + 2 + i * 4 + c]!);
          }
          else rgb = [0, 1, 2].map(c => sampleGradient(b, 1, fract(s.spatial - m), b[35]!, c));
          const level = Math.max(...BASE);
          return rgb.map(v => clamp01(v * (level < 1e-3 ? 1 : level)));
        }
        const p = clamp01(sampleSignedLut(b, 40, s.spatial - m));
        const hue = b[36]! + b[37]! * (2 * p - 1);
        const [h0, s0, l0] = rgbToHsl(...BASE);
        const h = l0 < 1e-3 ? h0 : fract(h0 + hue / 360);
        const w = b[39]! * p;
        const level = Math.max(...BASE);
        return hslToRgb(h, clamp01(s0 * b[38]!), l0).map(v => clamp01(v + (level - v) * w));
      }),
    };
  });
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[color shift goldens] ${cases.length} cases`);
