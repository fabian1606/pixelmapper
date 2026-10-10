/**
 * Generates `goldens.json` for Pattern (plan M8.5): every recipe on the
 * reference rig at 8 phases spread over the steps, from a TS reference of the
 * plugin math. Run: `bun run plugins/sequencer/goldens.gen.ts`
 */
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { presetParams } from '../../app/utils/engine/recipes';
import { isMultiHead, loadManifest, rigSamples } from '../_golden/reference';

const manifest = await loadManifest(import.meta.dir);
const cases = (manifest.presets ?? []).flatMap((preset) => {
  const params = presetParams(manifest, preset);
  const rig = rigSamples(preset, isMultiHead(preset));
  const b = encodeParams(manifest.params, params, { ticks: rig.ticks });
  const blocks = Math.round(b[0]!) === 1;
  const rows = Math.max(1, Math.round(b[1]!));
  const steps = Math.max(1, Math.round(b[2]!));
  const cell = (k: number, g: number) => ((Math.trunc(b[3 + k]!) >> g) & 1 ? 1 : 0);
  const transition = Math.max(0, Math.min(1, b[19]!));
  const invert = b[20]! >= 0.5;
  return Array.from({ length: 8 }, (_, i) => (i * steps) / 8 + 0.1).map((tp) => ({
    name: `${preset.id} @ ${tp.toFixed(3)}`,
    compare: 'raw',
    params,
    ctx: { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp, rankCount: rig.rankCount, distGroupCount: rig.distGroupCount, ticks: rig.ticks },
    samples: rig.samples.map(s => ({ x: s.x, y: s.y, phase: tp - s.spatial, base: [1], spatial: s.spatial, rank: s.rank, distGroup: s.distGroup, headIndex: s.head, headCount: s.headCount })),
    expected: rig.samples.map((s) => {
      let rank = s.rank;
      let count = rig.rankCount;
      if (rank < 0 || count <= 0) {
        count = 16;
        rank = Math.min(15, Math.floor(Math.max(0, Math.min(1, s.spatial)) * 16));
      }
      const g = s.distGroup >= 0 ? s.distGroup % rows : blocks ? Math.min(rows - 1, Math.trunc((rank * rows) / Math.max(count, 1))) : rank % rows;
      const fk = Math.floor(tp);
      const f = tp - fk;
      const k = ((fk % steps) + steps) % steps;
      let v = cell(k, g);
      if (transition > 0 && f > 1 - transition) {
        const t = (f - (1 - transition)) / transition;
        v = v + (cell((k + 1) % steps, g) - v) * (t * t * (3 - 2 * t));
      }
      return [invert ? 1 - v : v];
    }),
  }));
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[pattern goldens] ${cases.length} cases`);
