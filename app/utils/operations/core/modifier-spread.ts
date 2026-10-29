/**
 * Spread and speed in the UI vocabulary (ADR 0002 B3, ADR 0001 A20).
 *
 * The modifier card shows one "Spread" dropdown (All the same / Spatial 2D /
 * Fixture by fixture / Within each fixture) and a speed in beats or time.
 * The `modifiers.*` operations take the same concepts and translate them to
 * `ModifierInstance.distribution` / `speed` exactly like the card does
 * (`DistributionSection.setSpread`, `selectionDistribution`).
 *
 * Coordinates are normalized world space 0–1 (x left→right, y top→bottom on
 * the 2D canvas, the same space as plugin `Sample.x/y`).
 */
import { z } from 'zod';
import type { Distribution } from '@pixelmapper/extension-api';
import type { SpeedConfig } from '~/utils/engine/types';
import { resolveRanks, type OrderPoint } from '~/utils/engine/distribution/order';
import type { SelectionShape } from '~/utils/engine/distribution/selection-shape';
import { selectionDistribution } from '~/utils/engine/distribution/selection-defaults';
import { FixtureIdSchema } from './shared';

// ── Schemas ─────────────────────────────────────

/** A normalized world point. */
const PointSchema = z.object({ x: z.number(), y: z.number() }).describe('Normalized world point (0–1; x left→right, y top→bottom).');

/** Explicit fixture ranks (0 = first). */
const RanksSchema = z.record(z.string(), z.number().int().min(0))
  .describe('Explicit order by fixture id: 0 = first, equal numbers move together. Fixtures without a rank are placed by their position.');

/** Fixture ids in run order (converted to ranks 0..n−1). */
const FixtureOrderSchema = z.array(FixtureIdSchema).min(1)
  .describe('Fixture ids in run order; converted to ranks 0..n−1 (alternative to `ranks`).');

/** The spread of a modifier (card "Spread" dropdown). */
export const SpreadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('same'),
  }).describe('All the same: every fixture shows the same value at the same time.'),
  z.object({
    type: z.literal('spatial'),
    mode: z.enum(['linear', 'radial', 'conical']).optional()
      .describe('linear = along origin→end; radial = outward from origin (end sets the radius); conical = around origin (angle). Default: linear (or the current spatial mode).'),
    origin: PointSchema.optional().describe('Gradient start (normalized world). Default: start of the targets\' main axis (radial/conical: their centroid).'),
    end: PointSchema.optional().describe('Gradient end (normalized world). Default: end of the targets\' main axis.'),
    reverse: z.boolean().optional().describe('Run end→origin instead.'),
  }).describe('Spatial 2D: the effect travels across the room along a gradient handle.'),
  z.object({
    type: z.literal('order'),
    ranks: RanksSchema.optional(),
    fixtureOrder: FixtureOrderSchema.optional(),
    reverse: z.boolean().optional().describe('Run from the highest rank to 0.'),
  }).describe('Fixture by fixture: the effect steps through the fixtures in order (ranks). Without ranks/fixtureOrder the order follows the targets\' main axis.'),
  z.object({
    type: z.literal('within'),
    offset: z.enum(['none', 'order']).optional().describe('none = every fixture runs the same over its heads; order = fixtures follow each other by rank.'),
    ranks: RanksSchema.optional(),
    fixtureOrder: FixtureOrderSchema.optional(),
    reverse: z.boolean().optional(),
  }).describe('Within each fixture: the effect runs over the heads/pixels inside each fixture.'),
]);

/** Spread input type. */
export type SpreadInput = z.infer<typeof SpreadSchema>;

/** Spread as reported by `modifiers.list` (effective ranks resolved). */
export const SpreadViewSchema = z.object({
  type: z.enum(['same', 'spatial', 'order', 'within']),
  mode: z.enum(['linear', 'radial', 'conical']).optional(),
  origin: PointSchema.optional(),
  end: PointSchema.optional(),
  offset: z.enum(['none', 'order']).optional(),
  ranks: z.record(z.string(), z.number()).optional().describe('Effective ranks by fixture id (0 = first), resolved from explicit ranks and positions.'),
  reverse: z.boolean().optional(),
  grouping: z.object({ kind: z.string(), n: z.number() }).optional().describe('Rank grouping (only when not "none").'),
});

/** Spread view type. */
export type SpreadView = z.infer<typeof SpreadViewSchema>;

/** Speed input. */
export const SpeedSchema = z.object({
  mode: z.enum(['beat', 'time', 'infinite'])
    .describe('beat = synced to the project BPM; time = fixed duration; infinite = frozen (no motion).'),
  value: z.number().positive().optional()
    .describe('Length of one cycle (one pass of the effect): beat mode = beats per cycle (1 = one beat, 4 = one bar, 0.5 = half a beat); time mode = seconds per cycle. Omitted = keep the current value.'),
  beatOffset: z.number().optional().describe('Beat mode: phase offset in beats (e.g. 0.5 = half a beat later).'),
});

/** Speed input type. */
export type SpeedInput = z.infer<typeof SpeedSchema>;

/** Speed as reported by `modifiers.list`. */
export const SpeedViewSchema = z.object({
  mode: z.enum(['beat', 'time', 'infinite']),
  value: z.number().describe('Beat mode: beats per cycle; time mode: seconds per cycle; infinite: 0.'),
  beatOffset: z.number(),
});

// ── Spread → distribution ───────────────────────

/** Ranks from the input (`ranks` wins over `fixtureOrder`), or null. */
function inputRanks(spread: { ranks?: Record<string, number>; fixtureOrder?: (string | number)[] }): Record<string, number> | null {
  if (spread.ranks) return { ...spread.ranks };
  if (spread.fixtureOrder) return Object.fromEntries(spread.fixtureOrder.map((id, i) => [String(id), i]));
  return null;
}

/** True for the Spatial 2D modes. */
function isSpatialMode(mode: Distribution['mode']): mode is 'linear' | 'radial' | 'conical' {
  return mode === 'linear' || mode === 'radial' || mode === 'conical';
}

/**
 * The distribution `d` with `spread` applied (never mutates `d`). Like the
 * card: switching spreads keeps the other fields; a new Spatial 2D mode
 * without an explicit handle is placed on the targets (`shape`).
 */
export function spreadToDistribution(d: Distribution, spread: SpreadInput, shape: SelectionShape): Distribution {
  const reverse = 'reverse' in spread && spread.reverse !== undefined ? spread.reverse : d.reverse;
  switch (spread.type) {
    case 'same':
      return { ...d, scope: 'across', mode: 'none' };
    case 'spatial': {
      const mode = spread.mode ?? (isSpatialMode(d.mode) ? d.mode : 'linear');
      const keepHandle = d.scope === 'across' && d.mode === mode;
      const placed = keepHandle ? d : selectionDistribution({ ...d, mode }, shape);
      return {
        ...d,
        scope: 'across',
        mode,
        reverse,
        origin: { ...(spread.origin ?? placed.origin) },
        end: { ...(spread.end ?? placed.end) },
      };
    }
    case 'order': {
      const ranks = inputRanks(spread);
      return { ...d, scope: 'across', mode: 'order', reverse, order: ranks ? { ...d.order, ranks } : d.order };
    }
    case 'within': {
      const ranks = inputRanks(spread);
      return {
        ...d,
        scope: 'within',
        reverse,
        withinOffset: spread.offset ?? d.withinOffset,
        order: ranks ? { ...d.order, ranks } : d.order,
      };
    }
  }
}

// ── Distribution → spread ───────────────────────

/** The card's view of a distribution; `points` = target fixtures for rank resolution. */
export function distributionToSpread(d: Distribution, points: readonly OrderPoint[]): SpreadView {
  const grouping = d.grouping.kind !== 'none' ? { grouping: { kind: d.grouping.kind, n: d.grouping.n } } : {};
  const ranks = () => resolveRanks(d, points).ranks;
  if (d.scope === 'within') {
    return { type: 'within', offset: d.withinOffset, reverse: d.reverse, ...(d.withinOffset === 'order' ? { ranks: ranks() } : {}), ...grouping };
  }
  if (d.mode === 'none') return { type: 'same', ...grouping };
  if (d.mode === 'order') return { type: 'order', ranks: ranks(), reverse: d.reverse, ...grouping };
  return { type: 'spatial', mode: d.mode, origin: { ...d.origin }, end: { ...d.end }, reverse: d.reverse, ...grouping };
}

// ── Speed ───────────────────────────────────────

/** `speed` with the input applied (time values are seconds, stored as ms). */
export function applySpeed(speed: SpeedConfig, input: SpeedInput): SpeedConfig {
  const next: SpeedConfig = { ...speed, mode: input.mode };
  if (input.mode === 'time' && input.value !== undefined) next.timeMs = input.value * 1000;
  if (input.mode === 'beat' && input.value !== undefined) next.beatValue = input.value;
  if (input.beatOffset !== undefined) next.beatOffset = input.beatOffset;
  return next;
}

/** Speed in the operation vocabulary. */
export function speedView(speed: SpeedConfig): z.infer<typeof SpeedViewSchema> {
  const value = speed.mode === 'time' ? speed.timeMs / 1000 : speed.mode === 'beat' ? speed.beatValue : 0;
  return { mode: speed.mode, value, beatOffset: speed.beatOffset };
}
