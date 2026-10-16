import { describe, it, expect } from 'vitest';
import type { Fixture } from './core/fixture';
import type { SceneNode, FixtureGroup } from './core/group';
import {
  resolveAlignmentContext,
  buildAlignmentSession,
  queryAlignment,
  bboxCenter,
  collectDraggedFixtureIds,
  dominantPlaneGap,
  pinSpacingGap,
  VISIBLE_ALIGN_THRESHOLD,
  type AlignmentCandidate,
  type GuideLine,
  type SpacingGap,
} from './alignment-guides';

/**
 * The core only reads `.id`, `.parent` and `.children` off scene nodes, so
 * lightweight fakes are enough — no need to construct real Fixture instances.
 */
function fx(id: string): Fixture {
  return { id, parent: null } as unknown as Fixture;
}
function grp(id: string, children: Array<Fixture | FixtureGroup>): FixtureGroup {
  const g = { id, children, parent: null } as unknown as FixtureGroup;
  for (const c of children) (c as { parent: FixtureGroup | null }).parent = g;
  return g;
}
function cand(id: string, ...center: number[]): AlignmentCandidate {
  return { id, center, points: [center] };
}
/** A group candidate: aggregate center is the bbox center of its member points. */
function groupCand(id: string, points: number[][]): AlignmentCandidate {
  return { id, center: bboxCenter(points), points };
}
function session(candidates: AlignmentCandidate[], startCenter: number[], draggedStartPoints: number[][] = [startCenter]) {
  const s = buildAlignmentSession(candidates, startCenter, draggedStartPoints);
  if (!s) throw new Error('expected a session');
  return s;
}

const NO_GRID: Array<number | null> = [null, null];

describe('queryAlignment — center snap', () => {
  it('snaps an axis to the nearest candidate center within tolerance', () => {
    const s = session([cand('a', 100, 500)], [0, 0]);
    const r = queryAlignment(s, [96, 10], [6, 6], NO_GRID);
    expect(r.snappedAxes).toEqual([true, false]);
    expect(r.snappedDelta).toEqual([100, 10]);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]!.axis).toBe(0);
    expect(r.guides[0]!.value).toBe(100);
  });

  it('does not snap outside the tolerance', () => {
    const s = session([cand('a', 100, 500)], [0, 0]);
    const r = queryAlignment(s, [92, 10], [6, 6], NO_GRID);
    expect(r.snappedAxes).toEqual([false, false]);
    expect(r.snappedDelta).toEqual([92, 10]);
    expect(r.guides).toHaveLength(0);
  });

  it('snaps axes independently', () => {
    const s = session([cand('a', 100, 200)], [0, 0]);
    const r = queryAlignment(s, [98, 202], [6, 6], NO_GRID);
    expect(r.snappedAxes).toEqual([true, true]);
    expect(r.snappedDelta).toEqual([100, 200]);
    expect(r.guides).toHaveLength(2);
  });

  it('collects every candidate sharing the matched coordinate', () => {
    const s = session([cand('a', 100, 0), cand('b', 100, 50), cand('c', 100, 90), cand('d', 300, 0)], [0, 0]);
    const r = queryAlignment(s, [97, 20], [6, 6], NO_GRID);
    expect(r.guides[0]!.matchedCenters).toHaveLength(3);
  });

  it('exposes a mark over every member fixture of a matched group (dot per fixture)', () => {
    // A group whose members sit on x=100 at y 0/40/80. Centering the dragged item on x=100
    // matches the group; since the members lie ON the line, they themselves become the row
    // points and each gets a mark.
    const group = groupCand('g', [[100, 0], [100, 40], [100, 80]]);
    const s = session([group], [0, 0]);
    const r = queryAlignment(s, [98, 500], [6, 6], NO_GRID);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]!.matchedCenters).toEqual([[100, 0], [100, 40], [100, 80]]);
    expect(r.guides[0]!.marks).toEqual([[100, 0], [100, 40], [100, 80]]);
    expect(r.guides[0]!.dashed).toBe(false);
  });

  it('a group merely centered on the line (members off-line) contributes its aggregate center', () => {
    // Horizontal group at y=200, members spread in x; a horizontal line through y ≈ 250
    // exists only via a second, vertical group centered there. Match the vertical group's
    // y-center: its members sit at y 200/300 (off-line) → aggregate center is the row point,
    // dots over all members.
    const vertical = groupCand('v', [[500, 200], [500, 300]]);
    const s = session([vertical], [0, 248]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID); // y 248 → snaps to center 250
    const guide = r.guides.find(g => g.axis === 1)!;
    expect(guide.value).toBe(250);
    expect(guide.dashed).toBe(false);
    expect(guide.matchedCenters).toEqual([[500, 250]]);
    expect(guide.marks).toEqual([[500, 200], [500, 300]]);
  });

  it('picks the nearest of several candidate centers', () => {
    const s = session([cand('a', 100, 0), cand('b', 108, 0)], [0, 0]);
    const r = queryAlignment(s, [105, 0], [6, 6], NO_GRID);
    expect(r.snappedDelta[0]).toBe(108);
  });
});

describe('queryAlignment — grid interplay', () => {
  it('falls back to the grid on unmatched axes', () => {
    const s = session([cand('a', 100, 500)], [0, 0]);
    const r = queryAlignment(s, [98, 13], [6, 6], [25, 25]);
    expect(r.snappedDelta).toEqual([100, 25]); // x: alignment, y: grid
  });

  it('alignment wins over the grid on a matched axis', () => {
    const s = session([cand('a', 103, 500)], [0, 0]);
    const r = queryAlignment(s, [101, 0], [6, 6], [25, 25]);
    expect(r.snappedDelta[0]).toBe(103); // not 100 (grid)
  });
});

describe('queryAlignment — neighbor distance / equal spacing', () => {
  it('always reports the distance to the nearest neighbor, even when unequal', () => {
    // Single neighbor at y=0; dragged lands at y=70 — no other gap to match, but the
    // distance to that one neighbor must still show up.
    const s = session([cand('a', 0, 0)], [0, 68]);
    const r = queryAlignment(s, [2, 2], [6, 6], NO_GRID); // → target y ≈ 70
    expect(r.draggedCenter).toEqual([0, 70]);
    expect(r.spacing).toHaveLength(1);
    expect(r.spacing[0]!.distance).toBe(70);
  });

  it('reports both neighbor gaps when the dragged item sits between two, even if unequal', () => {
    const s = session([cand('a', 0, 0), cand('b', 0, 130)], [0, 48]);
    const r = queryAlignment(s, [2, 2], [6, 6], NO_GRID); // → target y ≈ 50
    expect(r.draggedCenter).toEqual([0, 50]);
    expect(r.spacing).toHaveLength(2);
    expect(r.spacing.map(g => g.distance).sort((a, b) => a - b)).toEqual([50, 80]);
  });

  // Two members aligned on x=0 at y 0 and 100; dragging near y=200 extends the run.
  it('snaps to a run extension and highlights every gap in the equal run', () => {
    const s = session([cand('a', 0, 0), cand('b', 0, 100)], [0, 150]);
    const r = queryAlignment(s, [2, 47], [6, 6], NO_GRID); // → target y ≈ 197
    expect(r.snappedAxes).toEqual([true, true]);
    expect(r.draggedCenter).toEqual([0, 200]);
    expect(r.spacing).toHaveLength(2);
    expect(r.spacing.every(g => g.distance === 100)).toBe(true);
  });

  it('snaps to the midpoint between two members', () => {
    const s = session([cand('a', 0, 0), cand('b', 0, 100)], [0, 40]);
    const r = queryAlignment(s, [2, 7], [6, 6], NO_GRID); // → target y ≈ 47
    expect(r.draggedCenter).toEqual([0, 50]);
    expect(r.spacing.every(g => g.distance === 50)).toBe(true);
  });

  it('every gap occurring in the row is a snap target, not just the outermost gap\'s extension', () => {
    // Row gaps differ: 150 then 200 (members y=0 at x 0/150/350). Extending the row past the
    // end, the user aims near +150 from the last member — the 150 gap exists elsewhere in the
    // row, so x=500 must be a snap target even though the LAST gap is 200.
    const s = session([cand('a', 0, 0), cand('b', 150, 0), cand('c', 350, 0)], [497, 3]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID); // y → row at 0; x 497 → snaps 500
    expect(r.snappedAxes).toEqual([true, true]);
    expect(r.draggedCenter).toEqual([500, 0]);
    expect(r.spacing.map(g => g.distance).sort((a, b) => a - b)).toEqual([150, 150]);
  });

  it('an equal-spacing target beats the grid within tolerance', () => {
    // Gaps 120 and 100 in the row; the grid is 10. Aiming near the 100-rhythm position
    // (x = 220 + 100 = 320) must snap to 320 via spacing, not to the grid's 10-multiples —
    // the grid only applies where no alignment matched.
    const s = session([cand('a', 0, 0), cand('b', 120, 0), cand('c', 220, 0)], [317, 3]);
    const r = queryAlignment(s, [0, 0], [6, 6], [10, 10]);
    expect(r.draggedCenter).toEqual([320, 0]); // 220 + 100, matching the row's 100 rhythm
    expect(r.spacing.map(g => g.distance).sort((a, b) => a - b)).toEqual([100, 100]);
  });

  it('a center match on the long axis beats the spacing snap', () => {
    // Candidate c sits on the long axis at y=52 — closer logic: y center-match wins over midpoint 50.
    const s = session([cand('a', 0, 0), cand('b', 0, 100), cand('c', 500, 52)], [0, 40]);
    const r = queryAlignment(s, [2, 11], [6, 6], NO_GRID); // target y ≈ 51
    expect(r.draggedCenter[1]).toBe(52);
  });

  it('does not highlight an unrelated gap that does not match the neighbor distance', () => {
    const s = session([cand('a', 0, 0), cand('b', 0, 100)], [0, 300]);
    const r = queryAlignment(s, [2, 0], [6, 6], NO_GRID); // dragged at y=300, gap 200 vs 100
    expect(r.snappedAxes[0]).toBe(true);
    // Only the immediate neighbor (b at y=100) shows, not a's unrelated gap further out.
    expect(r.spacing).toHaveLength(1);
    expect(r.spacing[0]!.distance).toBe(200);
  });

  it('highlights a matching gap elsewhere in the row even across an unrelated gap between (truss case)', () => {
    // Row: a=0, b=100 (gap 100), c=250 (gap 150, unrelated). Dragging the far end in
    // to y=350 makes its neighbor gap (c→dragged = 100) match a→b's gap, even though
    // b→c's 150 gap sits between them and never matches anything.
    const s = session([cand('a', 0, 0), cand('b', 0, 100), cand('c', 0, 250)], [0, 348]);
    const r = queryAlignment(s, [2, 2], [6, 6], NO_GRID); // → target y ≈ 350
    expect(r.draggedCenter).toEqual([0, 350]);
    const distances = r.spacing.map(g => g.distance).sort((a, b) => a - b);
    expect(distances).toEqual([100, 100]); // a→b and c→dragged; b→c's 150 is excluded
  });
});

describe('queryAlignment — group edges (outermost fixtures) as alignment lines', () => {
  it('a center-to-center match renders solid (dashed = false)', () => {
    const s = session([cand('a', 100, 500)], [0, 0]);
    const r = queryAlignment(s, [98, 0], [6, 6], NO_GRID);
    expect(r.guides[0]!.dashed).toBe(false);
    expect(r.guides[0]!.draggedPoint).toEqual([100, 0]);
  });

  it('snaps a lone fixture to a group\'s edge row and marks only the edge fixtures', () => {
    // Group members at y 100/200/300 → edges y=100 and y=300, center y=200. Dragging a
    // fixture toward y=97 must snap to the y=100 edge (dashed), dotting only the two
    // fixtures actually sitting on that row.
    const group = groupCand('g', [[0, 100], [50, 100], [25, 200], [25, 300]]);
    const s = session([group], [500, 0]);
    const r = queryAlignment(s, [0, 97], [6, 6], NO_GRID);
    expect(r.snappedAxes[1]).toBe(true);
    expect(r.snappedDelta[1]).toBe(100);
    const guide = r.guides.find(g => g.axis === 1)!;
    expect(guide.value).toBe(100);
    expect(guide.dashed).toBe(true);
    expect(guide.marks).toEqual([[0, 100], [50, 100]]); // only the edge row, not all 4 members
    expect(guide.draggedPoint).toEqual([500, 100]);     // dragged point sits ON the edge line
  });

  it('a dragged group\'s own edge snaps to a candidate line (offset-corrected delta)', () => {
    // Dragged group spans y=[200,300] (center 250). Its top edge (200) approaching the
    // candidate at y=103 within tolerance: snappedDelta must place the EDGE on 103,
    // i.e. delta.y = 103 - 200 = -97, not 103 - 250.
    const s = session([cand('a', 0, 103)], [0, 250], [[0, 200], [0, 300]]);
    const r = queryAlignment(s, [0, -100], [6, 6], NO_GRID); // top edge → 100, 3 away from 103
    expect(r.snappedAxes[1]).toBe(true);
    expect(r.snappedDelta[1]).toBe(-97);
    const guide = r.guides.find(g => g.axis === 1)!;
    expect(guide.dashed).toBe(true); // dragged-edge involvement renders dashed
    expect(guide.value).toBe(103);
  });

  it('prefers the closer pairing among center and edge offsets', () => {
    // Dragged group spans y=[200,300] (center 250). Candidate at y=252: the center (250,
    // diff 2) is closer than either edge — snap center-to-center, solid.
    const s = session([cand('a', 0, 252)], [0, 250], [[0, 200], [0, 300]]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID);
    expect(r.snappedDelta[1]).toBe(2);
    expect(r.guides.find(g => g.axis === 1)!.dashed).toBe(false);
  });

  it('edge guides carry no spacing highlights', () => {
    const group = groupCand('g', [[0, 100], [50, 100], [25, 300]]);
    const s = session([group], [500, 97]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID); // snaps to y=100 edge
    expect(r.guides.find(g => g.axis === 1)!.dashed).toBe(true);
    expect(r.spacing).toHaveLength(0);
  });

  it('a row where 4 of 5 fixtures are grouped stays a solid center line with distances', () => {
    // Regression: 4 fixtures in a group form a horizontal row (y=0, x 0/100/200/300); the 5th,
    // ungrouped fixture extends the row. Sparse mode lists the members individually AND the
    // group is appended as a candidate — its x-edges coincide with m0/m3's centers, and its
    // aggregate center sits mid-row. Neither may turn the y-guide dashed nor pollute the row:
    // expect a SOLID line and clean 100-unit gap labels.
    const memberPts: number[][] = [[0, 0], [100, 0], [200, 0], [300, 0]];
    const candidates = [
      ...memberPts.map((p, i) => ({ id: `m${i}`, center: p, points: [p] })),
      groupCand('g', memberPts),
    ];
    const s = session(candidates, [400, 3]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID); // y 3 → snaps to the row at y=0
    const guide = r.guides.find(g => g.axis === 1)!;
    expect(guide.value).toBe(0);
    expect(guide.dashed).toBe(false);
    expect(guide.matchedCenters).toEqual(memberPts); // no phantom aggregate at x=150
    expect(r.spacing.map(g => g.distance)).toEqual([100, 100, 100, 100]);
  });
});

describe('queryAlignment — 3 axes', () => {
  it('snaps each of three axes to its own candidate', () => {
    const s = buildAlignmentSession([cand('a', 1, 2, 3), cand('b', 5, 6, 7)], [0, 0, 0], [[0, 0, 0]])!;
    const r = queryAlignment(s, [0.9, 5.9, 3.1], [0.2, 0.2, 0.2], [null, null, null]);
    expect(r.snappedDelta).toEqual([1, 6, 3]);
    expect(r.guides.map(g => g.axis)).toEqual([0, 1, 2]);
  });
});

describe('queryAlignment — group spacing uses outermost members, not bbox center', () => {
  it('measures the neighbor gap from the nearest extreme member of a dragged group', () => {
    // Dragged "group" spans y=[200,210] (bbox center 205); its nearest member to the
    // candidate at y=100 is the one at y=200 — the gap must be measured from THAT member
    // (100), not from the group's bbox center (105).
    const s = session([cand('a', 0, 100)], [0, 205], [[0, 200], [0, 210]]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID);
    expect(r.spacing).toHaveLength(1);
    expect(r.spacing[0]!.distance).toBe(100); // 200 - 100, not 205 - 100
  });

  it('reports each side\'s gap from its own near member, excluding the group\'s internal span', () => {
    // Candidates at y=0 and y=400 flank the dragged group spanning y=[200,220] (bbox center
    // 210, deliberately far from any equal-spacing snap target so that pre-existing center-
    // based spacing-snap doesn't also kick in and muddy the numbers). Each side's gap must
    // come from that side's nearest member; the group's own internal 20-unit span must never appear.
    const s = session([cand('a', 0, 0), cand('b', 0, 400)], [0, 210], [[0, 200], [0, 220]]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID);
    const distances = r.spacing.map(g => g.distance).sort((a, b) => a - b);
    expect(distances).toEqual([180, 200]); // a→200 = 200, 220→b = 180; the internal 20 never appears
  });

  it('still matches a distant equal gap to whichever extreme member is on that side', () => {
    // Row: candidate a=0, candidate b=100 (gap 100). The dragged group spans [200,220]; its
    // near member (200) is 100 from b, matching a→b's gap.
    const s = session([cand('a', 0, 0), cand('b', 0, 100)], [0, 210], [[0, 200], [0, 220]]);
    const r = queryAlignment(s, [0, 0], [6, 6], NO_GRID);
    const distances = r.spacing.map(g => g.distance).sort((a, b) => a - b);
    expect(distances).toEqual([100, 100]); // a→b and b→group's near member (200)
  });

  it('a lone fixture (single dragged point) is unaffected by the extreme-member change', () => {
    const s = session([cand('a', 0, 0)], [0, 68]);
    const r = queryAlignment(s, [2, 2], [6, 6], NO_GRID);
    expect(r.spacing).toHaveLength(1);
    expect(r.spacing[0]!.distance).toBe(70);
  });

  it('pins the guide-axis coordinate to the matched value, never drawing a diagonal segment', () => {
    // The dragged group's own members sit far off-axis (x=-10 and x=10) from the group's
    // bbox center — realistic for a group whose fixtures aren't perfectly vertically stacked.
    // Once centered against candidate a (x=0), the spacing segment's endpoints must both
    // land on x=0 (the matched guide value), not on the members' own x — otherwise the
    // rendered line cuts diagonally across the canvas instead of running straight.
    const s = session([cand('a', 0, 0)], [5, 210], [[-5, 200], [15, 220]]);
    const r = queryAlignment(s, [-5, 0], [6, 6], NO_GRID);
    expect(r.snappedDelta[0]).toBe(-5); // centered on candidate a's x=0
    expect(r.spacing).toHaveLength(1);
    expect(r.spacing[0]!.from[0]).toBe(0);
    expect(r.spacing[0]!.to[0]).toBe(0);
    expect(r.spacing[0]!.distance).toBe(200);
  });
});

describe('bboxCenter / collectDraggedFixtureIds', () => {
  it('computes the bounding-box center, not the centroid', () => {
    expect(bboxCenter([[0, 0], [10, 0], [10, 100]])).toEqual([5, 50]);
  });

  it('collects fixtures whose ancestor chain hits the selection', () => {
    const f1 = fx('f1'), f2 = fx('f2'), f3 = fx('f3');
    const g = grp('g', [f1, f2]);
    void g;
    const dragged = collectDraggedFixtureIds([f1, f2, f3], new Set(['g']));
    expect(dragged).toEqual(new Set(['f1', 'f2']));
  });
});

describe('resolveAlignmentContext', () => {
  it('sparse viewport → individual visible fixtures, grouping ignored, but the whole group is still an extra candidate', () => {
    const f1 = fx('f1'), f2 = fx('f2'), f3 = fx('f3');
    const g = grp('g', [f1, f2]);
    const nodes: SceneNode[] = [g, f3];
    const ctx = resolveAlignmentContext(nodes, new Set(['f3']), new Set(['f1', 'f2', 'f3']));
    // f1/f2 individually (sparse mode) PLUS the group itself as one more candidate.
    expect(ctx.map(c => c.id).sort()).toEqual(['f1', 'f2', 'g']);
    expect(ctx.find(c => c.id === 'g')!.fixtures).toHaveLength(2);
  });

  it('a lone fixture can always align against an unrelated group (and its members), even outside its own context', () => {
    // f3 is a top-level fixture; the groups sit elsewhere in the tree entirely. Even in dense
    // mode (>8 visible fixtures, so grouping normally stays scoped to siblings), both groups
    // are top-level siblings of f3, so they — and each of their individual members — must show
    // up as candidates. A lone fixture can center against a whole group or one specific member.
    const members = Array.from({ length: VISIBLE_ALIGN_THRESHOLD + 4 }, (_, i) => fx(`m${i}`));
    const g = grp('g', members);
    const other = grp('other', [fx('o1'), fx('o2')]);
    const f3 = fx('f3');
    const nodes: SceneNode[] = [g, other, f3];
    const visible = new Set([...members.map(f => f.id), 'o1', 'o2', 'f3']);
    const ctx = resolveAlignmentContext(nodes, new Set(['f3']), visible);
    expect(ctx.map(c => c.id).sort()).toEqual(['g', 'o1', 'o2', 'other', ...members.map(f => f.id)].sort());
    expect(ctx.find(c => c.id === 'g')!.fixtures).toHaveLength(members.length);
  });

  it('a dragged group can align against another group as a whole, on top of its individual members', () => {
    const members = Array.from({ length: VISIBLE_ALIGN_THRESHOLD + 4 }, (_, i) => fx(`m${i}`));
    const dragged = grp('dragged', members);
    const other = grp('other', [fx('o1'), fx('o2')]);
    const nodes: SceneNode[] = [dragged, other];
    const visible = new Set([...members.map(f => f.id), 'o1', 'o2']);
    const ctx = resolveAlignmentContext(nodes, new Set(['dragged']), visible);
    // Only 2 non-dragged fixtures visible → sparse mode lists o1/o2 individually, PLUS the
    // always-on group append adds 'other' as a whole-group candidate too.
    expect(ctx.map(c => c.id).sort()).toEqual(['o1', 'o2', 'other']);
    expect(ctx.find(c => c.id === 'other')!.fixtures).toHaveLength(2);
  });

  it('dense viewport → siblings within the selection context', () => {
    const inner = Array.from({ length: VISIBLE_ALIGN_THRESHOLD + 4 }, (_, i) => fx(`f${i}`));
    const g = grp('g', inner);
    const outside = fx('out');
    const nodes: SceneNode[] = [g, outside];
    const visible = new Set([...inner.map(f => f.id), outside.id]);
    const ctx = resolveAlignmentContext(nodes, new Set(['f0']), visible);
    // Siblings inside the group only — the outside fixture is not a sibling.
    expect(ctx.map(c => c.id)).toEqual(inner.slice(1).map(f => f.id));
  });

  it('top-level selection → top-level nodes; a sibling group contributes both its aggregate and its individual members', () => {
    const members = Array.from({ length: VISIBLE_ALIGN_THRESHOLD + 4 }, (_, i) => fx(`m${i}`));
    const g = grp('g', members);
    const solo = fx('solo'), dragged = fx('dragged');
    const nodes: SceneNode[] = [g, solo, dragged];
    const visible = new Set([...members.map(f => f.id), 'solo', 'dragged']);
    const ctx = resolveAlignmentContext(nodes, new Set(['dragged']), visible);
    expect(ctx.map(c => c.id).sort()).toEqual(['g', 'solo', ...members.map(f => f.id)].sort());
    expect(ctx.find(c => c.id === 'g')!.fixtures).toHaveLength(members.length);
    expect(ctx.find(c => c.id === 'm0')!.fixtures).toEqual([members[0]]);
  });

  it('excludes candidates containing dragged fixtures and off-screen candidates', () => {
    const members = Array.from({ length: VISIBLE_ALIGN_THRESHOLD + 4 }, (_, i) => fx(`m${i}`));
    const g = grp('g', members);
    const hidden = fx('hidden'), dragged = fx('dragged');
    const nodes: SceneNode[] = [g, hidden, dragged];
    const visible = new Set([...members.map(f => f.id), 'dragged']); // 'hidden' off-screen
    // Cross-group multi-select: one group member drags along.
    const ctx = resolveAlignmentContext(nodes, new Set(['dragged', 'm0']), visible);
    expect(ctx).toHaveLength(0); // g contains a dragged fixture, hidden is off-screen
  });
});

describe('pinSpacingGap — axis-parallel spacing segments (3D)', () => {
  const guide: GuideLine = {
    axis: 1, // matched on Y = 2
    value: 2,
    matchedCenters: [],
    marks: [],
    dashed: false,
    draggedPoint: [5, 2, 0.5],
  };

  it('pins both endpoints onto the owning guide line', () => {
    // Members share Y within tolerance but sit at different heights (axis 2).
    const gap: SpacingGap = { axis: 0, from: [1, 2.001, 0.9], to: [3, 1.999, 0.1], distance: 2 };
    const { from, to } = pinSpacingGap(gap, [guide], 0.01);
    expect(from).toEqual([1, 2, 0.5]);
    expect(to).toEqual([3, 2, 0.5]);
  });

  it('never pins to a dashed guide or one on the gap axis, and falls back to `from`', () => {
    const dashed: GuideLine = { ...guide, dashed: true };
    const sameAxis: GuideLine = { ...guide, axis: 0, dashed: false };
    const gap: SpacingGap = { axis: 0, from: [1, 2, 0.9], to: [3, 2.4, 0.1], distance: 2 };
    const { from, to } = pinSpacingGap(gap, [dashed, sameAxis], 0.01);
    expect(from).toEqual([1, 2, 0.9]);
    expect(to).toEqual([3, 2, 0.9]); // still axis-parallel: only axis 0 differs
  });
});

describe('dominantPlaneGap — distance to a dominant plane along the drag axis', () => {
  it('measures to the plane when >1/3 of fixtures share the drag-axis value and the drag left it', () => {
    // 6 fixtures on plane z=2 (axis 2), spread over x/y; dragged one pulled to z=0.5.
    const cands = [
      cand('a', 0, 0, 2), cand('b', 1, 0, 2), cand('c', 2, 0, 2),
      cand('d', 0, 1, 2), cand('e', 1, 1, 2), cand('f', 2, 1, 2),
    ];
    const s = session(cands, [1, 0.5, 2], [[1, 0.5, 2]]);
    const gap = dominantPlaneGap(s, [1, 0.5, 0.5], 2, 0.01);
    expect(gap).not.toBeNull();
    expect(gap!.axis).toBe(2);
    expect(gap!.distance).toBeCloseTo(1.5, 5);
    expect(gap!.from).toEqual([1, 0.5, 0.5]);
    expect(gap!.to).toEqual([1, 0.5, 2]);
  });

  it('returns null when the dragged point still sits on the plane', () => {
    const cands = [cand('a', 0, 0, 2), cand('b', 1, 0, 2), cand('c', 2, 0, 2), cand('d', 0, 1, 2)];
    const s = session(cands, [1, 0.5, 2], [[1, 0.5, 2]]);
    expect(dominantPlaneGap(s, [1, 0.5, 2], 2, 0.01)).toBeNull();
  });

  it('returns null when no plane holds more than a third of the fixtures', () => {
    // Six distinct z values → largest cluster is 1/6, below the threshold.
    const cands = [
      cand('a', 0, 0, 0), cand('b', 0, 0, 1), cand('c', 0, 0, 2),
      cand('d', 0, 0, 3), cand('e', 0, 0, 4), cand('f', 0, 0, 5),
    ];
    const s = session(cands, [0, 0, 10], [[0, 0, 10]]);
    expect(dominantPlaneGap(s, [0, 0, 10], 2, 0.01)).toBeNull();
  });
});
