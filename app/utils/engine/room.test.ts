// @vitest-environment node
/** The TS room twin matches `rs-engine/core/src/room.rs` (same cases as its unit tests). */
import { describe, expect, it } from 'vitest';
import { defaultRoom, roomAspect, roomFromPoints, roomUv } from './room';

describe('room twin', () => {
  it('box and uv', () => {
    const r = roomFromPoints([{ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.5 }], 12);
    expect(roomAspect(r)).toBeCloseTo(4, 5);
    const { u, v } = roomUv(r, 0.6, 0.4);
    expect(u).toBeCloseTo(1, 5);
    expect(v).toBeCloseTo(0, 5);
    expect(r.metersPerUnit).toBe(12);
  });

  it('degenerate axes', () => {
    // One row: depth borrows the width, v centered at 0.5.
    let r = roomFromPoints([{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }]);
    expect(roomAspect(r)).toBe(1);
    expect(roomUv(r, 0.25, 0.5).v).toBeCloseTo(0.5, 6);
    // One fixture: unit box centered on it.
    r = roomFromPoints([{ x: 0.3, y: 0.3 }]);
    expect([r.width, r.depth]).toEqual([1, 1]);
    expect(roomUv(r, 0.3, 0.3).u).toBeCloseTo(0.5, 6);
    // Empty layout: default.
    expect(roomFromPoints([])).toEqual(defaultRoom());
  });
});
