/**
 * Generates `goldens.json` for Corner Wave (plan M5 reference effect): every
 * recipe on a 6 × 4 grid of single-head fixtures at 8 phases, computed by a
 * TS reference of the plugin math (nearest-point distance, pulse band, reach
 * fade, palette per front).
 * Run: `bun run plugins/corner-wave/goldens.gen.ts`
 */
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import { presetParams } from '../../app/utils/engine/recipes';
import { loadManifest, PHASES, sampleGradient } from '../_golden/reference';

const manifest = await loadManifest(import.meta.dir);

/** 6 × 4 grid inside the stage (world x/y; also the room u/v of the golden harness). */
const GRID = Array.from({ length: 24 }, (_, i) => ({ x: 0.15 + (i % 6) * 0.14, y: 0.2 + Math.floor(i / 6) * 0.2 }));

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const fract = (t: number) => t - Math.floor(t);

/** SDK `pulse(d, center, width, softness)`. */
function pulse(d: number, center: number, width: number, softness: number): number {
  if (width <= 0) return 0;
  const half = width * 0.5;
  const dd = Math.abs(d - center);
  if (dd >= half) return 0;
  const inner = half * (1 - clamp01(softness));
  if (dd <= inner) return 1;
  return 1 - smooth((dd - inner) / (half - inner));
}

const cases = (manifest.presets ?? []).flatMap((preset) => {
  const params = presetParams(manifest, preset);
  const p = encodeParams(manifest.params, params, {});
  const spacing = Math.max(p[33]!, 0.01);
  const [width, softness] = [p[34]!, p[35]!];
  const inward = Math.round(p[36]!) === 1;
  const reach = Math.max(p[37]!, 0.01);
  const sources = Math.round(p[38]!);
  const pts = Array.from({ length: sources }, (_, i) => [p[39 + 2 * i]!, p[40 + 2 * i]!] as const);
  return PHASES.map((tp) => ({
    name: `${preset.id} @ ${tp.toFixed(3)}`,
    compare: 'raw',
    params,
    ctx: { timeMs: 0, beatTime: 0, bpm: 120, phaseSpeed: 1, strength: 1, timePhase: tp },
    samples: GRID.map(s => ({ x: s.x, y: s.y, phase: 0, base: [0, 0, 0] })),
    expected: GRID.map((s) => {
      const d = Math.min(...pts.map(([px, py]) => Math.hypot(s.x - px, s.y - py)));
      const w = d / spacing;
      const pos = inward ? w + tp : w - tp;
      let v = pulse(fract(pos), 0.5, width, softness);
      v *= 1 - smooth(clamp01((d - reach * 0.7) / (reach * 0.3)));
      const u = fract(Math.floor(pos) * 0.25);
      return [0, 1, 2].map(c => sampleGradient(p, 0, u, 1, c) * v);
    }),
  }));
});
await Bun.write(`${import.meta.dir}/goldens.json`, JSON.stringify({ cases }));
console.log(`[corner-wave goldens] ${cases.length} cases`);
