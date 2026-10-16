/**
 * Pattern 2.x → 3 (modifier review): the "Groups" param (`arrange`) is gone;
 * the spread decides how fixtures form the grid's rows (Fixture by fixture
 * alternates, Spatial 2D cuts bands). Blocks over the order become bands
 * along the order's line (or along the handle when no line was drawn); a
 * mirrored order (Outside-In) becomes radial bands around the line's start.
 * Hand-clicked numbers are lost for Blocks, which is acceptable.
 */
import type { Distribution, ParamValue } from '@pixelmapper/extension-api';
import type { LegacyPatch } from '../builtin-legacy';

/** The Pattern 3 params and distribution of a Pattern 2 instance. */
export function migrateSequencerV2(p: Record<string, ParamValue>, d?: Distribution): LegacyPatch {
  const { arrange, ...params } = p;
  if (arrange !== 'blocks' || !d || d.scope === 'within' || d.mode !== 'order') return { params };
  const line = d.order.line;
  const a = line?.a ?? d.origin;
  const b = line?.b ?? d.end;
  if (d.order.mirror) {
    return { params, distribution: { ...d, mode: 'radial', origin: { ...a }, end: { ...b }, order: { ...d.order, mirror: false } } };
  }
  return { params, distribution: { ...d, mode: 'linear', origin: { ...a }, end: { ...b } } };
}
