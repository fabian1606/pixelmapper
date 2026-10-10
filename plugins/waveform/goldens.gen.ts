/**
 * Generates `goldens.json` for Wave (plan M6.3): every recipe on the
 * reference rig (8 PARs in a row; 4 bars × 4 pixels for multi-head recipes)
 * at 8 phases, computed by a TS reference of the plugin math.
 * Run: `bun run plugins/waveform/goldens.gen.ts`
 */
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { presetParams } from '../../app/utils/engine/recipes';
import { isMultiHead, loadManifest, PHASES, rigSamples, sampleLut, sampleSignedLut } from '../_golden/reference';

const manifest = await loadManifest(import.meta.dir);
const cases = (manifest.presets ?? []).flatMap((preset) => {
  const params = presetParams(manifest, preset);
  const rig = rigSamples(preset, isMultiHead(preset));
  const lut = encodeParams(manifest.params, params, { ticks: rig.ticks });
  return PHASES.map((tp) => {
    const m = sampleLut(lut, 128, tp - Math.floor(tp));
    const invert = lut[256]! >= 0.5;
    return {
      name: `${preset.id} @ ${tp.toFixed(3)}`,
      compare: 'raw',
      params,
      ctx: { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp, rankCount: rig.rankCount, distGroupCount: rig.distGroupCount, ticks: rig.ticks },
      samples: rig.samples.map(s => ({ x: s.x, y: s.y, phase: tp - s.spatial, base: [1], spatial: s.spatial, rank: s.rank, distGroup: s.distGroup, headIndex: s.head, headCount: s.headCount })),
      expected: rig.samples.map((s) => {
        const v = Math.max(0, Math.min(1, sampleSignedLut(lut, 0, s.spatial - m)));
        return [invert ? 1 - v : v];
      }),
    };
  });
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[wave goldens] ${cases.length} cases`);
