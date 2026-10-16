/**
 * Distribution factory and patching (plan M3.1, §1.1).
 */
import type { Distribution, DistributionPatch } from '@pixelmapper/extension-api';

/** Copies a drawn line (plain objects; works on reactive proxies). */
function cloneLine(line: Distribution['order']['line']): Distribution['order']['line'] {
  return line ? { a: { x: line.a.x, y: line.a.y }, b: { x: line.b.x, y: line.b.y } } : undefined;
}

/** Default distribution (modifiers override it via manifest defaults and recipes). */
export function createDistribution(patch: DistributionPatch = {}): Distribution {
  return applyDistributionPatch({
    scope: 'across',
    mode: 'none',
    origin: { x: 0.4, y: 0.5 },
    end: { x: 0.6, y: 0.5 },
    reverse: false,
    order: { ranks: {}, snap: 0.5 },
    grouping: { kind: 'none', n: 2, seed: 1 },
    withinOffset: 'none',
  }, patch);
}

/**
 * Returns `base` with `patch` applied; nested `order`/`grouping` merge field
 * by field. Never mutates its inputs.
 */
export function applyDistributionPatch(base: Distribution, patch: DistributionPatch = {}): Distribution {
  return {
    scope: patch.scope ?? base.scope,
    mode: patch.mode ?? base.mode,
    origin: { ...(patch.origin ?? base.origin) },
    end: { ...(patch.end ?? base.end) },
    reverse: patch.reverse ?? base.reverse,
    order: {
      ranks: { ...(patch.order?.ranks ?? base.order.ranks) },
      line: cloneLine(patch.order && 'line' in patch.order ? patch.order.line : base.order.line),
      mirror: patch.order?.mirror ?? base.order.mirror,
      snap: patch.order?.snap ?? base.order.snap,
    },
    grouping: { ...base.grouping, ...(patch.grouping ?? {}) },
    withinOffset: patch.withinOffset ?? base.withinOffset,
  };
}
