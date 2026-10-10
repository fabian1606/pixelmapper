/**
 * Places a distribution on the current selection (plan M5.8): gradient
 * handles along the selection's main axis (radial: from the centroid to the
 * ring radius), and the order line along the axis so ranks resolve
 * automatically. Explicit ranks are cleared (the order follows the rig).
 */
import type { Distribution } from '@pixelmapper/extension-api';
import type { SelectionShape } from './selection-shape';

/** The distribution with handle and order line taken from the selection. */
export function selectionDistribution(d: Distribution, shape: SelectionShape): Distribution {
  const axis = { a: { ...shape.axis.a }, b: { ...shape.axis.b } };
  if (d.mode === 'radial') {
    const r = Math.max(shape.radius, 0.05);
    return { ...d, origin: { ...shape.centroid }, end: { x: shape.centroid.x + r, y: shape.centroid.y } };
  }
  if (d.mode === 'conical') return { ...d, origin: { ...shape.centroid }, end: { x: shape.centroid.x + 0.1, y: shape.centroid.y } };
  // Center Out: a mirrored order runs from the middle of the axis outward.
  const line = d.order.mirror
    ? { a: { x: (axis.a.x + axis.b.x) / 2, y: (axis.a.y + axis.b.y) / 2 }, b: axis.b }
    : axis;
  return { ...d, origin: axis.a, end: axis.b, order: { ...d.order, ranks: {}, line } };
}
