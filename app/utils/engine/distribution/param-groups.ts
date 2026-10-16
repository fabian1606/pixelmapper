/**
 * Groups shown on the canvas for modifiers with a `steps` param (plan M8.2,
 * R1): rows of the step grid derived from the order numbers, Alternate
 * (rank mod rows) or Blocks (⌊rank·rows / rankCount⌋) via the `arrange`
 * param. Mirrors the Pattern plugin.
 */
import type { ParamSchema, ParamValue, StepsValue } from '@pixelmapper/extension-api';

/** Row of `rank` among `count` ranks. */
export function rowOf(rank: number, count: number, rows: number, blocks: boolean): number {
  if (rank < 0 || count <= 0 || rows <= 0) return -1;
  return blocks ? Math.min(rows - 1, Math.trunc((rank * rows) / count)) : rank % rows;
}

/** Grid rows and arrangement of a modifier's params, or null without a `steps` param. */
export function stepsLayout(schema: ParamSchema, params: Record<string, ParamValue>): { rows: number; blocks: boolean } | null {
  const def = schema.find(p => p.type === 'steps');
  if (!def) return null;
  const v = (params[def.key] ?? def.default) as StepsValue;
  return { rows: Math.max(1, v.groups), blocks: params.arrange === 'blocks' };
}
