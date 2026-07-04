/**
 * Normalizes WheelEvent deltas to CSS pixels across browsers.
 *
 * Chrome/Safari always report `deltaMode 0` (pixels), but Firefox reports
 * mouse-wheel scrolls as `DOM_DELTA_LINE` (deltaY ≈ 3 "lines") and can report
 * `DOM_DELTA_PAGE` — feeding those raw values into pixel-based pan/zoom math
 * makes the gesture near-imperceptible there. Trackpad swipes are pixel-mode
 * in all browsers, so those pass through unchanged.
 */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

export function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  const scale =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_HEIGHT_PX
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? PAGE_HEIGHT_PX
        : 1;
  return { dx: e.deltaX * scale, dy: e.deltaY * scale };
}
