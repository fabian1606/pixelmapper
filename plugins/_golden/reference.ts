/**
 * Shared helpers for golden generation of the rewritten built-ins (plan
 * M6.3–M9.6): reference rigs, distribution samples and the SDK's LUT
 * interpolation. Used by `plugins/<name>/goldens.gen.ts` (run with Bun).
 */
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import { createDistribution } from '../../app/utils/engine/distribution/create';
import { resolveRanks } from '../../app/utils/engine/distribution/order';
import { frameCounts, sampleDistribution, spreadKind } from '../../app/utils/engine/distribution/sample';
import { analyzeSelection } from '../../app/utils/engine/distribution/selection-shape';
import { selectionDistribution } from '../../app/utils/engine/distribution/selection-defaults';

/**
 * A sample of a reference rig with its distribution values. ABI v1.3 room
 * fields (`z`, `u`, `v`) are not used by the built-ins; the golden harness
 * fills a unit room (z 0, u/v = x/y) when a case omits them.
 */
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
export function rigSamples(preset: ManifestPreset, multiHead: boolean): { samples: RigSample[]; rankCount: number; distGroupCount: number; ticks: number; spread: number; handle: [number, number, number, number] } {
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
  return { samples, ...counts, ticks, spread: spreadKind(d), handle: [d.origin.x, d.origin.y, d.end.x, d.end.y] };
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

/** SDK `rgbToHsl` (h ∈ [0, 1)). */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (Math.abs(max - min) < 1e-6) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** SDK `hslToRgb`. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** SDK `sampleGradient` (channel `c`) on an encoded gradient at `offset`. */
export function sampleGradient(buf: Float32Array, offset: number, u: number, transition: number, c: number): number {
  const n = Math.max(1, Math.min(8, Math.trunc(buf[offset]!)));
  const pos = (i: number) => buf[offset + 1 + i * 4]!;
  const ch = (i: number) => buf[offset + 2 + i * 4 + c]!;
  if (n === 1) return ch(0);
  const x = u - Math.floor(u);
  let k = n - 1;
  for (let i = 0; i < n; i++) if (x < pos(i)) { k = i - 1; break; }
  const ki = k < 0 ? n - 1 : k;
  const kj = (ki + 1) % n;
  const start = k < 0 ? pos(n - 1) - 1 : pos(ki);
  const end = kj === 0 ? pos(0) + 1 : pos(kj);
  const f = (x - start) / Math.max(end - start, 1e-6);
  const w = Math.max(transition, 0);
  let t = 0;
  if (w > 0 && f > 1 - w) {
    const s = (f - (1 - w)) / w;
    t = s * s * (3 - 2 * s);
  }
  return ch(ki) + (ch(kj) - ch(ki)) * t;
}

/** SDK `seededRandom` (u32 hash → [0, 1)). */
export function seededRandom(seed: number): number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  s = (Math.imul(s, 0x45d9f3b) + (s >>> 16)) >>> 0;
  s = (Math.imul(s, 0x45d9f3b) + (s >>> 16)) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  return Math.fround(Math.fround(s) / Math.fround(0xffffffff));
}

/** SDK `hash01(seed, i)`. */
export const hash01 = (seed: number, i: number) => seededRandom((seed ^ Math.imul(i >>> 0, 0x9e3779b9)) >>> 0);

/** Stable 24-bit sample seed of a rig sample (as the engine's per fixture/head seeds). */
export const rigSeed = (fixture: number, head: number) => (Math.imul(fixture + 1, 0x9e3779b1) ^ Math.imul(head + 7, 0x85ebca6b)) >>> 8;
