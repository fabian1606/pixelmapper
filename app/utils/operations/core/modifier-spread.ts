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

/** Run directions on the 2D canvas (x left→right, y top→bottom). */
export const DIRECTIONS = ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'] as const;

/** Run direction of a spread. */
export type Direction = typeof DIRECTIONS[number];

/** Direction input (default left-to-right). */
const DirectionSchema = z.enum(DIRECTIONS)
  .describe('Run direction on the 2D canvas. Default: left-to-right along x (fixtures with the same x move together; top-to-bottom when all targets share one x). Overridden by origin/end, ranks or fixtureOrder.');

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
    direction: DirectionSchema.optional(),
    origin: PointSchema.optional().describe('Gradient start (normalized world). Default: the targets\' left edge (per `direction`; radial/conical: their centroid).'),
    end: PointSchema.optional().describe('Gradient end (normalized world). Default: the targets\' right edge (per `direction`).'),
    reverse: z.boolean().optional().describe('Run end→origin instead.'),
  }).describe('Spatial 2D: the effect travels across the room along a gradient handle.'),
  z.object({
    type: z.literal('order'),
    direction: DirectionSchema.optional(),
    ranks: RanksSchema.optional(),
    fixtureOrder: FixtureOrderSchema.optional(),
    reverse: z.boolean().optional().describe('Run from the highest rank to 0.'),
  }).describe('Fixture by fixture: the effect steps through the fixtures in order (ranks). Without ranks/fixtureOrder the order runs left→right (or `direction`).'),
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

// ── Direction ───────────────────────────────────

/** Half length of an axis across targets without extent in that direction. */
const MIN_HALF_SPAN = 0.05;

/**
 * The run axis a → b across `points` for `direction` (default: left→right
 * when the points span x, else top→bottom when they span y, else null =
 * keep the selection's own axis, e.g. one multi-head fixture).
 */
export function directedAxis(points: readonly { x: number; y: number }[], direction?: Direction): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  if (points.length === 0) return null;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dir = direction ?? (maxX - minX > 1e-6 ? 'left-to-right' : maxY - minY > 1e-6 ? 'top-to-bottom' : null);
  if (!dir) return null;
  const spanX = maxX - minX > 1e-6 ? [minX, maxX] : [cx - MIN_HALF_SPAN, cx + MIN_HALF_SPAN];
  const spanY = maxY - minY > 1e-6 ? [minY, maxY] : [cy - MIN_HALF_SPAN, cy + MIN_HALF_SPAN];
  switch (dir) {
    case 'left-to-right': return { a: { x: spanX[0]!, y: cy }, b: { x: spanX[1]!, y: cy } };
    case 'right-to-left': return { a: { x: spanX[1]!, y: cy }, b: { x: spanX[0]!, y: cy } };
    case 'top-to-bottom': return { a: { x: cx, y: spanY[0]! }, b: { x: cx, y: spanY[1]! } };
    case 'bottom-to-top': return { a: { x: cx, y: spanY[1]! }, b: { x: cx, y: spanY[0]! } };
  }
}

/** Compass words of a direction vector (`left→right`, `top-left→bottom-right`, …). */
export function directionWords(dx: number, dy: number): string {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 'none';
  const h = Math.abs(dx / len) > 0.38 ? (dx > 0 ? ['left', 'right'] : ['right', 'left']) : null;
  const v = Math.abs(dy / len) > 0.38 ? (dy > 0 ? ['top', 'bottom'] : ['bottom', 'top']) : null;
  if (h && v) return `${v[0]}-${h[0]}→${v[1]}-${h[1]}`;
  return h ? `${h[0]}→${h[1]}` : `${v![0]}→${v![1]}`;
}

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
      // A new direction re-places the handle; otherwise the current handle stays.
      const keepHandle = !spread.direction && d.scope === 'across' && d.mode === mode;
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
      // A direction lays the order line along it (`shape` carries the directed axis).
      const order = ranks ? { ...d.order, ranks } : spread.direction ? selectionDistribution({ ...d, mode: 'order' }, shape).order : d.order;
      return { ...d, scope: 'across', mode: 'order', reverse, order };
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
