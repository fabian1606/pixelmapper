/**
 * Distribution of a modifier instance over fixtures (plan §1.1, ADR A20).
 *
 * Shared by every modifier: it produces per sample `spatial` (0 at the
 * origin / first rank, 1 at the end / after the last rank), `rank` and
 * `distGroup`. It replaces the former direction/origin/angle/fanning/reverse
 * fields.
 */
import type { Vec2 } from './model';

/** Over fixtures, or over the heads/pixels inside each fixture. */
export type DistributionScope = 'across' | 'within';

/** How `spatial` is derived. `none` = all samples equal. */
export type DistributionMode = 'none' | 'linear' | 'radial' | 'conical' | 'order';

/** Optional mapping of ranks to groups. */
export type GroupingKind = 'none' | 'everyN' | 'sections' | 'random';

/** Fixture order (mode `order`, and scope `within` with offset `order`). */
export interface DistributionOrder {
  /** Explicit ranks by fixture id (click tool / resolved line). */
  ranks: Record<string, number>;
  /** Last drawn line; places fixtures without an explicit rank. */
  line?: { a: Vec2; b: Vec2 };
  /** Rank by distance from `line.a` on both sides (symmetric order). */
  mirror?: boolean;
  /** Cluster tolerance as a fraction of the median spacing (0–1). */
  snap: number;
}

/** Grouping of ranks. `n` = group count (everyN, sections, random). */
export interface DistributionGrouping {
  kind: GroupingKind;
  n: number;
  seed: number;
}

/** How an instance spreads over fixtures (shared by all modifiers). */
export interface Distribution {
  scope: DistributionScope;
  mode: DistributionMode;
  /** Gradient handle, normalized world coords (linear/radial/conical). */
  origin: Vec2;
  end: Vec2;
  /** Mirrors spatial: s → 1 − s. */
  reverse: boolean;
  order: DistributionOrder;
  grouping: DistributionGrouping;
  /** Scope `within`: offset fixtures by their order rank. */
  withinOffset: 'none' | 'order';
}

/** A partial distribution (manifest defaults, recipes); nested objects may be partial too. */
export interface DistributionPatch {
  scope?: DistributionScope;
  mode?: DistributionMode;
  origin?: Vec2;
  end?: Vec2;
  reverse?: boolean;
  order?: Partial<DistributionOrder>;
  grouping?: Partial<DistributionGrouping>;
  withinOffset?: 'none' | 'order';
}
