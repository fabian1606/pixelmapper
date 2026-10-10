/**
 * Shared helpers for golden generation of the rewritten built-ins (plan
 * M6.3–M9.6): reference rigs, distribution samples and the SDK's LUT
 * interpolation. Used by `plugins/<name>/goldens.gen.ts` (run with Bun).
 */
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import { createDistribution } from '../../app/utils/engine/distribution/create';
import { resolveRanks } from '../../app/utils/engine/distribution/order';
import { frameCounts, sampleDistribution } from '../../app/utils/engine/distribution/sample';
import { analyzeSelection } from '../../app/utils/engine/distribution/selection-shape';
import { selectionDistribution } from '../../app/utils/engine/distribution/selection-defaults';

/** A sample of a reference rig with its distribution values. */
export interface RigSample {
  x: number; y: number; head: number; headCount: number; fixture: number;
  spatial: number; rank: number; distGroup: number;
}

/** 8 PARs in a row, or `bars` LED bars with `heads` pixels. */
export function referenceRig(multiHead: boolean): { x: number; y: number; heads: number }[] {
  return multiHead
    ? Array.from({ length: 4 }, (_, i) => ({ x: 0.2 + i * 0.2, y: 0.5, heads: 4 }))
    : Array.from({ length: 8 }, (_, i) => ({ x: (i + 0.5) / 8, y: 0.5, heads: 1 }));
}

/** Samples of a preset's distribution placed on a rig (as on add). */
export function rigSamples(preset: ManifestPreset, multiHead: boolean): { samples: RigSample[]; rankCount: number; distGroupCount: number; ticks: number } {
  const rig = referenceRig(multiHead);
  const shape = analyzeSelection(rig);
  const d = selectionDistribution(createDistribution(preset.distribution), shape);
  const pts = rig.map((f, i) => ({ id: i, x: f.x, y: f.y }));
  const { ranks, rankCount } = d.mode === 'order' || d.withinOffset === 'order' ? resolveRanks(d, pts) : { ranks: {}, rankCount: 0 };
  const samples: RigSample[] = [];
  rig.forEach((f, i) => {
    for (let h = 0; h < f.heads; h++) {
      const x = f.heads > 1 ? f.x - 0.05 + (0.1 * h) / (f.heads - 1) : f.x;
      const s = sampleDistribution(d, rankCount, { x, y: f.y, fixtureRank: ranks[String(i)] ?? -1, head: h, headCount: f.heads });
      samples.push({ x, y: f.y, head: h, headCount: f.heads, fixture: i, spatial: s.spatial, rank: s.rank, distGroup: s.group });
    }
  });
  const counts = frameCounts(d, rankCount, Math.max(...rig.map(f => f.heads)));
  const ticks = d.scope === 'within' ? Math.max(...rig.map(f => f.heads)) : d.mode === 'order' ? rankCount : rig.length;
  return { samples, ...counts, ticks };
}

/** SDK `sampleLut` (linear interpolation, x clamped to [0, 1]). */
export function sampleLut(lut: Float32Array, offset: number, x: number, size = 128): number {
  const cx = Math.max(0, Math.min(1, x));
  const pos = Math.fround(cx * (size - 1));
  const i = Math.floor(pos);
  if (i >= size - 1) return lut[offset + size - 1]!;
  const t = pos - i;
  const a = lut[offset + i]!;
  const b = lut[offset + i + 1]!;
  return a + (b - a) * t;
}

/** SDK `sampleSignedLut` (wraps outside [−1, 1]). */
export function sampleSignedLut(lut: Float32Array, offset: number, x: number): number {
  let w = x;
  if (x < -1 || x > 1) {
    const y = (x + 1) * 0.5;
    w = (y - Math.floor(y)) * 2 - 1;
  }
  return sampleLut(lut, offset, (w + 1) * 0.5);
}

/** The 8 reference phases (slightly off the grid to avoid exact edges). */
export const PHASES = Array.from({ length: 8 }, (_, k) => k / 8 + 0.03);

/** True when the preset targets multi-head fixtures. */
export const isMultiHead = (p: ManifestPreset) => !!p.when?.multiHead || p.distribution?.scope === 'within';

/** Loads a manifest JSON. */
export async function loadManifest(dir: string): Promise<ContentPluginManifest> {
  return JSON.parse(await Bun.file(`${dir}/manifest.json`).text()) as ContentPluginManifest;
}
