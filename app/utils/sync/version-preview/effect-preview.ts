import type { ModifierInstance } from '~/utils/engine/types';
import type { PreviewPoint, PreviewResult } from '~/utils/plugins/preview-pool';
import { resolveRanks } from '~/utils/engine/distribution/order';
import { usesRanks } from '~/utils/engine/distribution/resolve';
import { PREVIEW_SHAPE } from '~/utils/sync/remote-api-snapshot-preview';
import { NEUTRAL_COLOR, PREVIEW_WORLD, type PlacedFixture, type PreviewModel } from './preview-model';

/**
 * Pure part of the effect hover preview (version history): which fixtures
 * of a snapshot layout an effect targets, the plugin samples for them (one
 * per single fixture, one per pixel dot of a multi-beam bar) with order
 * ranks like the engine, and the mapping of rendered values to colors.
 * The frame loop lives in `effect-animator.ts`, drawing in `effect-canvas.ts`,
 * wording in `effect-text.ts`.
 */

// ── Targets ──────────────────────────────────────────────────────────────────

/**
 * Indices into `model.fixtures` targeted by `m`: all fixtures when
 * `targetFixtureIds` is undefined, else the ids found in `fixtureIndex`
 * (ids of fixtures outside the drawn layout are skipped). Sorted, unique.
 */
export function effectTargets(
  m: Pick<ModifierInstance, 'targetFixtureIds'>,
  model: PreviewModel,
  fixtureIndex: Record<string, number>,
): number[] {
  const n = model.fixtures.length;
  if (!m.targetFixtureIds) return Array.from({ length: n }, (_, i) => i);
  const set = new Set<number>();
  for (const id of m.targetFixtureIds) {
    const i = fixtureIndex[String(id)];
    if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

// ── Colors ───────────────────────────────────────────────────────────────────

/** Parses `#rgb` / `#rrggbb` into 0–1 channels; anything else → white. */
export function parseColor(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return [1, 1, 1];
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  const v = Number.parseInt(full, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Base tint of a fixture: its color, white for the neutral (multi-color) one. */
function tintOf(f: PlacedFixture): [number, number, number] {
  return f.color === NEUTRAL_COLOR ? [1, 1, 1] : parseColor(f.color);
}

// ── Sample points ────────────────────────────────────────────────────────────

/** One targeted fixture's slice of the point list. */
export interface EffectTarget {
  /** Index into `model.fixtures`. */
  fixture: number;
  /** First point index and number of points (1, or the dot count of a bar). */
  start: number;
  count: number;
}

/** Plugin samples of an effect over the targeted fixtures. */
export interface EffectPoints {
  points: PreviewPoint[];
  targets: EffectTarget[];
  /** Per point tint (r, g, b in 0–1) used for scalar outputs. */
  tint: Float32Array;
  /** Order rank count (0 when the distribution has no ranks). */
  rankCount: number;
  /** Ticks for curve params (as `resolveDistribution`). */
  ticks: number;
}

/**
 * Builds the samples of `m` over `targets` (indices into `model.fixtures`).
 * Positions are normalized world coordinates; dots of multi-beam fixtures
 * are rotated with the fixture. Order ranks resolve like the engine
 * (`resolveRanks` over the targeted fixtures' centers, ids from
 * `fixtureIndex`, `#<index>` for fixtures without a known id).
 */
export function buildEffectPoints(
  m: Pick<ModifierInstance, 'distribution' | 'signature'>,
  model: PreviewModel,
  targets: readonly number[],
  fixtureIndex: Record<string, number> = {},
): EffectPoints {
  const idOf = new Map<number, string>();
  for (const [id, i] of Object.entries(fixtureIndex)) if (!idOf.has(i)) idOf.set(i, id);
  const key = (i: number) => idOf.get(i) ?? `#${i}`;

  const d = m.distribution;
  const { ranks, rankCount } = usesRanks(d)
    ? resolveRanks(d, targets.map(i => ({ id: key(i), x: model.fixtures[i]!.cx / PREVIEW_WORLD, y: model.fixtures[i]!.cy / PREVIEW_WORLD })))
    : { ranks: {} as Record<string, number>, rankCount: 0 };

  const points: PreviewPoint[] = [];
  const out: EffectTarget[] = [];
  const tints: number[] = [];
  let maxHeads = 1;
  targets.forEach((fi, t) => {
    const f = model.fixtures[fi]!;
    const tint = tintOf(f);
    const base = m.signature === 'rgb' ? tint : undefined;
    const fixtureRank = ranks[key(fi)] ?? -1;
    const dots = f.shape === PREVIEW_SHAPE.multi && f.dots.length > 0 ? f.dots : null;
    const start = points.length;
    if (dots) {
      const rad = (f.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      dots.forEach((dot, h) => {
        const wx = f.cx + dot.x * cos - dot.y * sin;
        const wy = f.cy + dot.x * sin + dot.y * cos;
        points.push({ x: wx / PREVIEW_WORLD, y: wy / PREVIEW_WORLD, fixtureRank, head: h, headCount: dots.length, fixture: t, fixtureCount: targets.length, base });
        tints.push(...tint);
      });
      maxHeads = Math.max(maxHeads, dots.length);
    }
    else {
      points.push({ x: f.cx / PREVIEW_WORLD, y: f.cy / PREVIEW_WORLD, fixtureRank, head: 0, headCount: 1, fixture: t, fixtureCount: targets.length, base });
      tints.push(...tint);
    }
    out.push({ fixture: fi, start, count: points.length - start });
  });

  const ticks = d.scope === 'within' ? maxHeads : d.mode === 'order' ? rankCount : targets.length;
  return { points, targets: out, tint: Float32Array.from(tints), rankCount, ticks };
}

// ── Value → color ────────────────────────────────────────────────────────────

/**
 * Maps a preview result to RGB bytes per point (`out`, reused when large
 * enough): rgb as is, scalar as a tint of the fixture color (white for
 * neutral fixtures), panTilt as pan → red, tilt → green (like `previewRgb`).
 */
export function effectColors(result: PreviewResult, tint: Float32Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { values, arity } = result;
  const n = Math.floor(values.length / Math.max(1, arity));
  const rgb = out && out.length >= n * 3 ? out : new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const v = i * arity;
    if (arity === 3) {
      rgb[o] = values[v]! * 255;
      rgb[o + 1] = values[v + 1]! * 255;
      rgb[o + 2] = values[v + 2]! * 255;
    }
    else if (arity === 2) {
      rgb[o] = values[v]! * 255;
      rgb[o + 1] = values[v + 1]! * 255;
      rgb[o + 2] = 128;
    }
    else {
      const s = values[v]! * 255;
      rgb[o] = s * tint[o]!;
      rgb[o + 1] = s * tint[o + 1]!;
      rgb[o + 2] = s * tint[o + 2]!;
    }
  }
  return rgb;
}
