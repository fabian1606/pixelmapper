import type { Fixture } from './core/fixture';
import type { SceneNode, FixtureGroup } from './core/group';

/**
 * Figma-style live alignment guides, shared by the 2D editor and the 3D
 * viewport. Center-alignment only. Kept framework-agnostic (no Vue/DOM/Three
 * imports, mirroring `selection-logic.ts`) and axis-generic: the 2D canvas
 * uses 2 axes in world-pixels, the 3D viewport 3 axes in meters — same code.
 *
 * Shape of a drag:
 *  - drag start: `resolveAlignmentContext` picks the candidate nodes (Figma
 *    context rules), the caller turns them into centers, and
 *    `buildAlignmentSession` sorts them per axis — O(n log n), once.
 *  - per pointermove: `queryAlignment` binary-searches the nearest candidate
 *    center per axis — O(log n) — snaps the shared drag delta, and derives
 *    guide lines + equal-spacing highlights from the matched row.
 */

/** Screen-space stickiness of a center-alignment match, in CSS pixels. */
export const ALIGN_TOLERANCE_PX = 6;
/** Screen-space tolerance for two gaps to count as "equal", in CSS pixels. */
export const SPACING_TOLERANCE_PX = 6;
/**
 * When at most this many non-dragged fixtures are visible in the viewport,
 * alignment works against all of them individually (grouping ignored) —
 * the "zoomed in on a few fixtures" mode. Above it, alignment stays inside
 * the selection context (group siblings / top-level nodes).
 */
export const VISIBLE_ALIGN_THRESHOLD = 8;

export interface AlignmentCandidate {
  id: string | number;
  /**
   * The point alignment matches against: [x, y] world-px in 2D; [x, y, z]
   * meters in 3D. For a group this is its members' bounding-box center.
   */
  center: number[];
  /**
   * Individual fixture centers making up this candidate — one entry for a
   * lone fixture, one per member for a group. Used to draw a guide dot over
   * *every* involved fixture, not just the aggregate center point.
   */
  points: number[][];
}

export interface AlignmentSession {
  axisCount: number;
  candidates: AlignmentCandidate[];
  /**
   * Per axis: sorted snap-target values. Each candidate contributes its
   * center, and a multi-fixture candidate (group) additionally contributes
   * its two edges — the outermost member centers on that axis — so things
   * can align to a group's edge row, not only to its aggregate center.
   */
  targetValues: Float64Array[];
  /** Per axis: candidate index per target, parallel to `targetValues`. */
  targetCandidate: Int32Array[];
  /** Per axis: target kind per entry — 0 = center, 1 = edge (outermost members). */
  targetKind: Int8Array[];
  /** Bounding-box center of the dragged selection at drag start. */
  selectionStartCenter: number[];
  /**
   * Start position of every individual fixture in the dragged selection —
   * used to find the group's outermost members per axis for neighbor-distance
   * labels. A lone fixture's list has exactly one entry, so min === max ===
   * itself and its spacing behaves exactly as before.
   */
  draggedStartPoints: number[][];
  /**
   * Per axis: the dragged selection's own snap offsets relative to
   * `selectionStartCenter` — 0 (its center) first, then its min/max edges
   * for a multi-fixture drag. A dragged group therefore snaps when its
   * center OR its outermost row meets a target line.
   */
  draggedOffsets: number[][];
}

export interface GuideLine {
  /** The axis the centers match on (a vertical line in 2D is an x/axis-0 match). */
  axis: number;
  /** The matched coordinate on that axis. */
  value: number;
  /** Representative points of every matched candidate on the line (line extent + spacing row). */
  matchedCenters: number[][];
  /**
   * Individual fixture points to draw a guide dot on. A center match on a
   * group dots every member; an edge match dots only the outermost members
   * actually sitting on the matched edge; a lone fixture dots its center.
   */
  marks: number[][];
  /**
   * True when the match involves a group edge (target edge or the dragged
   * selection's own edge) — rendered dashed. Pure center-to-center matches
   * render solid.
   */
  dashed: boolean;
  /**
   * The dragged selection's point ON the guide line — its center for a
   * center match, or the spot where its matched edge crosses the line.
   * Renderers extend the line to here instead of to `draggedCenter`, which
   * for an edge match doesn't lie on the line at all.
   */
  draggedPoint: number[];
}

export interface SpacingGap {
  /** Gaps are measured along this axis (the guide's long axis). */
  axis: number;
  /** Center-to-center segment endpoints, full coords. */
  from: number[];
  to: number[];
  /** This gap's size, in session units (world px / meters). */
  distance: number;
}

export interface AlignmentResult {
  /** Raw delta with snapped axes replaced (alignment > spacing > grid). */
  snappedDelta: number[];
  /** Per axis: whether an alignment (center or spacing) match won over grid. */
  snappedAxes: boolean[];
  /** Dragged selection center after snapping, full coords. */
  draggedCenter: number[];
  guides: GuideLine[];
  spacing: SpacingGap[];
}

function isGroup(node: SceneNode): node is FixtureGroup {
  return Array.isArray((node as FixtureGroup).children);
}

function nodeFixtures(node: SceneNode): Fixture[] {
  if (!isGroup(node)) return [node];
  const out: Fixture[] = [];
  for (const child of node.children) out.push(...nodeFixtures(child));
  return out;
}

/** Every fixture that moves with the drag: its ancestor chain hits `selectedIds`. */
export function collectDraggedFixtureIds(
  fixtures: Fixture[],
  selectedIds: Set<string | number>,
): Set<string | number> {
  const dragged = new Set<string | number>();
  for (const f of fixtures) {
    let curr: SceneNode | null = f as unknown as SceneNode;
    while (curr) {
      if (selectedIds.has(curr.id)) { dragged.add(f.id); break; }
      curr = curr.parent;
    }
  }
  return dragged;
}

function findNodeById(nodes: SceneNode[], id: string | number): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (isGroup(node)) {
      const hit = findNodeById(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Every FixtureGroup anywhere in the tree, at any nesting depth. */
function collectAllGroups(nodes: SceneNode[]): FixtureGroup[] {
  const out: FixtureGroup[] = [];
  for (const node of nodes) {
    if (isGroup(node)) {
      out.push(node);
      out.push(...collectAllGroups(node.children));
    }
  }
  return out;
}

/**
 * Resolves which scene nodes act as alignment targets, following Figma's
 * context rules:
 *  1. Fixtures moving with the drag never align against themselves.
 *  2. Sparse viewport (≤ VISIBLE_ALIGN_THRESHOLD visible non-dragged
 *     fixtures) → those fixtures individually, grouping ignored.
 *  3. Otherwise → siblings of the selection (its group's children, or the
 *     top-level nodes), each sibling as one candidate (a group aligns via
 *     its members' bounding-box center).
 *  4. Regardless of mode, every visible group anywhere in the scene is
 *     *always* an additional candidate (its members' bounding-box center) —
 *     a lone fixture can center against a whole group, and a dragged group
 *     can center against another group, not just against individual members.
 * Candidates fully off-screen or touching the dragged set are excluded.
 */
export function resolveAlignmentContext(
  sceneNodes: SceneNode[],
  selectedIds: Set<string | number>,
  visibleFixtureIds: Set<string | number>,
): Array<{ id: string | number; fixtures: Fixture[] }> {
  const allFixtures: Fixture[] = [];
  for (const node of sceneNodes) allFixtures.push(...nodeFixtures(node));
  const dragged = collectDraggedFixtureIds(allFixtures, selectedIds);

  const visibleOthers = allFixtures.filter(f => visibleFixtureIds.has(f.id) && !dragged.has(f.id));
  let out: Array<{ id: string | number; fixtures: Fixture[] }>;
  if (visibleOthers.length > 0 && visibleOthers.length <= VISIBLE_ALIGN_THRESHOLD) {
    out = visibleOthers.map(f => ({ id: f.id, fixtures: [f] }));
  } else {
    // Selection-context mode: siblings of the (first) selected node.
    const firstSelectedId = selectedIds.values().next().value;
    const selectedNode = firstSelectedId !== undefined ? findNodeById(sceneNodes, firstSelectedId) : null;
    const siblings = selectedNode?.parent ? selectedNode.parent.children : sceneNodes;

    out = [];
    for (const sib of siblings) {
      const fixtures = nodeFixtures(sib);
      // Skip nodes that move with the drag (selected, or cross-group
      // multi-select pulled one of their fixtures into the drag).
      if (fixtures.length === 0 || fixtures.some(f => dragged.has(f.id))) continue;
      // Off-screen candidates never draw guides.
      if (!fixtures.some(f => visibleFixtureIds.has(f.id))) continue;
      out.push({ id: sib.id, fixtures });
      // A sibling that's a whole group also exposes its individual members as
      // separate candidates, on top of the group's own aggregate center above —
      // a fixture near a group should be able to center against one specific
      // fixture inside it, not only against the group as a whole.
      if (isGroup(sib)) {
        for (const member of fixtures) {
          if (dragged.has(member.id) || !visibleFixtureIds.has(member.id)) continue;
          out.push({ id: member.id, fixtures: [member] });
        }
      }
    }
  }

  const seenIds = new Set(out.map(c => c.id));
  for (const group of collectAllGroups(sceneNodes)) {
    if (seenIds.has(group.id)) continue;
    const fixtures = nodeFixtures(group);
    if (fixtures.length === 0 || fixtures.some(f => dragged.has(f.id))) continue;
    if (!fixtures.some(f => visibleFixtureIds.has(f.id))) continue;
    out.push({ id: group.id, fixtures });
    seenIds.add(group.id);
  }
  return out;
}

/** Bounding-box center over a list of per-axis centers. */
export function bboxCenter(centers: number[][]): number[] {
  const first = centers[0]!;
  const min = first.slice();
  const max = first.slice();
  for (let i = 1; i < centers.length; i++) {
    const c = centers[i]!;
    for (let a = 0; a < c.length; a++) {
      if (c[a]! < min[a]!) min[a] = c[a]!;
      if (c[a]! > max[a]!) max[a] = c[a]!;
    }
  }
  return min.map((v, a) => (v + max[a]!) / 2);
}

/**
 * Sorts snap targets per axis — call once at drag start. O(n log n). Each
 * candidate contributes its center; a group additionally contributes its two
 * edges (outermost member centers) per axis. The dragged selection likewise
 * gets center + edge offsets, so edge-to-edge and edge-to-center matches all
 * work symmetrically.
 */
export function buildAlignmentSession(
  candidates: AlignmentCandidate[],
  selectionStartCenter: number[],
  draggedStartPoints: number[][],
): AlignmentSession | null {
  if (candidates.length === 0) return null;
  const axisCount = selectionStartCenter.length;
  const targetValues: Float64Array[] = [];
  const targetCandidate: Int32Array[] = [];
  const targetKind: Int8Array[] = [];
  for (let a = 0; a < axisCount; a++) {
    const entries: Array<{ v: number; c: number; k: number }> = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci]!;
      entries.push({ v: cand.center[a]!, c: ci, k: 0 });
      if (cand.points.length > 1) {
        let min = Infinity, max = -Infinity;
        for (const p of cand.points) {
          if (p[a]! < min) min = p[a]!;
          if (p[a]! > max) max = p[a]!;
        }
        if (max > min) {
          entries.push({ v: min, c: ci, k: 1 });
          entries.push({ v: max, c: ci, k: 1 });
        }
      }
    }
    entries.sort((p, q) => p.v - q.v);
    targetValues.push(Float64Array.from(entries, e => e.v));
    targetCandidate.push(Int32Array.from(entries, e => e.c));
    targetKind.push(Int8Array.from(entries, e => e.k));
  }

  const draggedOffsets: number[][] = [];
  for (let a = 0; a < axisCount; a++) {
    // Center offset first — on an exact tie the center-to-target match wins.
    const offs = [0];
    if (draggedStartPoints.length > 1) {
      let min = Infinity, max = -Infinity;
      for (const p of draggedStartPoints) {
        if (p[a]! < min) min = p[a]!;
        if (p[a]! > max) max = p[a]!;
      }
      if (max > min) {
        offs.push(min - selectionStartCenter[a]!, max - selectionStartCenter[a]!);
      }
    }
    draggedOffsets.push(offs);
  }

  return {
    axisCount, candidates, targetValues, targetCandidate, targetKind,
    selectionStartCenter, draggedStartPoints, draggedOffsets,
  };
}

/** First index with arr[idx] >= x. */
function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Index of the value in `arr` closest to x. */
function nearestIndex(arr: Float64Array, x: number): number {
  const i = lowerBound(arr, x);
  if (i === 0) return 0;
  if (i >= arr.length) return arr.length - 1;
  return x - arr[i - 1]! <= arr[i]! - x ? i - 1 : i;
}

/** Appends points not already present (coordinate-wise within eps) — keeps rows/marks duplicate-free. */
function pushUnique(arr: number[][], pts: number[][], eps: number): void {
  outer: for (const p of pts) {
    for (const q of arr) {
      let same = true;
      for (let i = 0; i < p.length; i++) {
        if (Math.abs(p[i]! - q[i]!) > eps + 1e-9) { same = false; break; }
      }
      if (same) continue outer;
    }
    arr.push(p);
  }
}

/**
 * All snap targets whose axis-a value equals `value` (within eps): the row
 * points (for line extent / spacing), the fixture points to dot, and whether
 * this is a pure edge match.
 *
 * Two coincidence rules keep a fixture row containing a group honest:
 *  - A group's edge value coincides with its outermost member's own center —
 *    if ANY center entry matched, the line is a center alignment (solid, with
 *    distances), never a dashed edge line. `anyEdge` is true only when
 *    exclusively edge entries matched.
 *  - A group lying ALONG the line contributes its on-line members as row
 *    points instead of its aggregate center — the aggregate would inject a
 *    phantom point into the middle of the row and wreck the gap distances.
 *    A group merely *centered* on the line (members off-line) contributes its
 *    aggregate center, with dots over all members.
 */
function matchedTargetsAt(
  session: AlignmentSession,
  axis: number,
  value: number,
  eps: number,
): { centers: number[][]; marks: number[][]; anyEdge: boolean } {
  const vals = session.targetValues[axis]!;
  const candIdx = session.targetCandidate[axis]!;
  const kinds = session.targetKind[axis]!;
  const centers: number[][] = [];
  const marks: number[][] = [];
  let anyCenter = false;
  const start = lowerBound(vals, value - eps);
  for (let k = start; k < vals.length && vals[k]! <= value + eps; k++) {
    const cand = session.candidates[candIdx[k]!]!;
    if (kinds[k] === 0) {
      anyCenter = true;
      const onLine = cand.points.length > 1
        ? cand.points.filter(p => Math.abs(p[axis]! - value) <= eps + 1e-9)
        : [];
      if (onLine.length > 0) {
        pushUnique(centers, onLine, eps);
        pushUnique(marks, onLine, eps);
      } else {
        pushUnique(centers, [cand.center], eps);
        pushUnique(marks, cand.points, eps);
      }
    } else {
      const onEdge = cand.points.filter(p => Math.abs(p[axis]! - value) <= eps + 1e-9);
      pushUnique(centers, onEdge, eps);
      pushUnique(marks, onEdge, eps);
    }
  }
  return { centers, marks, anyEdge: !anyCenter };
}

/** The cross axis with the largest spread among the given centers. */
function longAxisFor(guideAxis: number, centers: number[][], axisCount: number): number {
  let best = guideAxis === 0 ? 1 : 0;
  let bestSpread = -1;
  for (let a = 0; a < axisCount; a++) {
    if (a === guideAxis) continue;
    let min = Infinity, max = -Infinity;
    for (const c of centers) {
      if (c[a]! < min) min = c[a]!;
      if (c[a]! > max) max = c[a]!;
    }
    const spread = max - min;
    if (spread > bestSpread) { bestSpread = spread; best = a; }
  }
  return best;
}

/**
 * Distance-to-neighbor gaps along `axis` among `members` + the dragged
 * selection's outermost point(s) on that axis: sorts by axis and always
 * reports the gap(s) to the dragged item's immediate neighbor(s) — one on
 * each side, or just one at an edge. For a multi-fixture drag (a group),
 * `draggedPoints` is that group's two extreme members along this axis, so
 * the reported distance is "outermost fixture to its neighbor" rather than
 * an abstract group bounding-box center — the number a user dragging a
 * 10-fixture truss actually expects to see. A lone fixture's `draggedPoints`
 * has one entry, so behavior is identical to a plain single-point gap.
 *
 * Any *other* gap anywhere in the row (not just adjacent/contiguous ones)
 * that matches one of those neighbor gaps within tolerance lights up too —
 * e.g. adjusting one end of a truss to match a spacing that's already
 * regular further down the row, with an unrelated gap in between. The gap
 * *between* a group's own two extreme points (its own span, not a gap to a
 * neighbor) is never reported. O(k²) worst case, k = guide-row size — fine
 * at truss/row scale.
 */
function collectSpacingGaps(
  axis: number,
  members: number[][],
  draggedPoints: number[][],
  tolerance: number,
): SpacingGap[] {
  if (members.length === 0 || draggedPoints.length === 0) return [];
  const dragged = draggedPoints.length > 1 && draggedPoints[0] !== draggedPoints[1]
    ? draggedPoints
    : [draggedPoints[0]!];
  const row = [...members, ...dragged].sort((p, q) => p[axis]! - q[axis]!);
  const draggedIdxs = dragged.map(p => row.indexOf(p));
  const gaps: number[] = [];
  for (let i = 0; i < row.length - 1; i++) gaps.push(row[i + 1]![axis]! - row[i]![axis]!);

  // A gap directly between two of the dragged selection's own points is its
  // own internal span, not a distance to a neighbor — never report it.
  const internalGapIdxs = new Set<number>();
  for (const di of draggedIdxs) {
    if (draggedIdxs.includes(di + 1)) internalGapIdxs.add(di);
  }

  const seeds = new Set<number>();
  for (const di of draggedIdxs) {
    if (di - 1 >= 0 && !internalGapIdxs.has(di - 1)) seeds.add(di - 1);
    if (di < gaps.length && !internalGapIdxs.has(di)) seeds.add(di);
  }
  if (seeds.size === 0) return [];

  const matched = new Set<number>(seeds);
  for (const seed of seeds) {
    const seedValue = gaps[seed]!;
    for (let g = 0; g < gaps.length; g++) {
      if (internalGapIdxs.has(g)) continue;
      if (Math.abs(gaps[g]! - seedValue) <= tolerance) matched.add(g);
    }
  }

  return Array.from(matched).sort((a, b) => a - b)
    .map(g => ({ axis, from: row[g]!, to: row[g + 1]!, distance: gaps[g]! }));
}

/** The dragged selection's extreme value(s) along `axis` (min, max) — one entry if it's a single point. */
function extremeAxisValues(points: number[][], axis: number): number[] {
  if (points.length === 0) return [];
  let min = points[0]![axis]!, max = points[0]![axis]!;
  for (const p of points) {
    if (p[axis]! < min) min = p[axis]!;
    if (p[axis]! > max) max = p[axis]!;
  }
  return min === max ? [min] : [min, max];
}

/**
 * Equal-spacing snap targets along `axis` derived from the members alone:
 * midpoints of adjacent member pairs, plus every member position offset by
 * every distinct gap occurring in the row (±). The latter makes EVERY
 * displayed distance a snap target — a row with gaps 1.20m and 1.15m offers
 * both 1.20 and 1.15 next to each member, so matching an existing rhythm
 * always beats the coarser grid.
 */
function spacingSnapTargets(axis: number, members: number[][], eps: number): number[] {
  if (members.length < 2) return [];
  const pos = members.map(c => c[axis]!).sort((a, b) => a - b);
  const targets: number[] = [];
  const gaps: number[] = [];
  for (let i = 0; i < pos.length - 1; i++) {
    const gap = pos[i + 1]! - pos[i]!;
    if (gap <= eps) continue;
    targets.push((pos[i]! + pos[i + 1]!) / 2);
    if (!gaps.some(g => Math.abs(g - gap) <= eps)) gaps.push(gap);
  }
  for (const p of pos) {
    for (const g of gaps) targets.push(p - g, p + g);
  }
  return targets;
}

/**
 * Per-pointermove query: snaps the raw drag delta per axis (center alignment
 * first, then equal-spacing along an active guide, then the grid fallback)
 * and returns the guides + spacing highlights to render.
 *
 * @param tolerance    per-axis snap tolerance in session units
 *                     (ALIGN_TOLERANCE_PX ÷ scale in 2D, × worldPerPixel in 3D)
 * @param gridSpacing  per-axis grid spacing for non-matched axes, null = free
 */
export function queryAlignment(
  session: AlignmentSession,
  rawDelta: number[],
  tolerance: number[],
  gridSpacing: Array<number | null>,
): AlignmentResult {
  const { axisCount, selectionStartCenter } = session;
  const snappedDelta = rawDelta.slice();
  const snappedAxes: boolean[] = new Array(axisCount).fill(false);
  const guides: GuideLine[] = [];

  // 1) Line alignment per axis — for each of the dragged selection's snap
  // offsets (center + its own edges), binary search the nearest target value
  // (candidate centers + group edges); the closest pairing within tolerance
  // wins. Center offset is tried first, so exact ties go center-to-target.
  for (let a = 0; a < axisCount; a++) {
    const vals = session.targetValues[a]!;
    let best: { value: number; diff: number; off: number } | null = null;
    for (const off of session.draggedOffsets[a]!) {
      const target = selectionStartCenter[a]! + rawDelta[a]! + off;
      const near = nearestIndex(vals, target);
      const diff = Math.abs(vals[near]! - target);
      if (diff <= tolerance[a]! && (best === null || diff < best.diff)) {
        best = { value: vals[near]!, diff, off };
      }
    }
    if (!best) continue;
    snappedDelta[a] = best.value - selectionStartCenter[a]! - best.off;
    snappedAxes[a] = true;
    const eps = tolerance[a]! * 0.01;
    const { centers, marks, anyEdge } = matchedTargetsAt(session, a, best.value, eps);
    guides.push({
      axis: a,
      value: best.value,
      matchedCenters: centers,
      marks,
      dashed: anyEdge || best.off !== 0,
      draggedPoint: [], // filled in below, once every axis' snap is final
    });
  }

  // 2) Equal-spacing snap along each guide's long axis (weaker than a line
  // match; center-to-center guides only — edge matches carry no spacing
  // rhythm). Like step 1, the dragged selection's own edge offsets snap too,
  // so a dragged group matches a rhythm with its outermost fixture.
  for (const guide of guides) {
    if (guide.dashed) continue;
    const longAxis = longAxisFor(guide.axis, guide.matchedCenters, axisCount);
    if (snappedAxes[longAxis]) continue;
    const targets = spacingSnapTargets(longAxis, guide.matchedCenters, tolerance[longAxis]! * 0.01);
    let best: { target: number; off: number; diff: number } | null = null;
    for (const off of session.draggedOffsets[longAxis]!) {
      const current = selectionStartCenter[longAxis]! + rawDelta[longAxis]! + off;
      for (const t of targets) {
        const diff = Math.abs(t - current);
        if (diff <= tolerance[longAxis]! && (best === null || diff < best.diff)) {
          best = { target: t, off, diff };
        }
      }
    }
    if (best !== null) {
      snappedDelta[longAxis] = best.target - selectionStartCenter[longAxis]! - best.off;
      snappedAxes[longAxis] = true;
    }
  }

  // 3) Grid fallback on axes nothing matched.
  for (let a = 0; a < axisCount; a++) {
    const spacing = gridSpacing[a];
    if (!snappedAxes[a] && spacing != null) {
      snappedDelta[a] = Math.round(snappedDelta[a]! / spacing) * spacing;
    }
  }

  const draggedCenter = selectionStartCenter.map((c, a) => c + snappedDelta[a]!);
  const draggedFinalPoints = session.draggedStartPoints.map(p => p.map((v, a) => v + snappedDelta[a]!));

  // The dragged selection's point ON each guide line: cross coords from its
  // final center, guide-axis coord pinned to the matched value (which for an
  // edge match is the edge row, not the center).
  for (const guide of guides) {
    const p = draggedCenter.slice();
    p[guide.axis] = guide.value;
    guide.draggedPoint = p;
  }

  // 4) Neighbor-distance highlights, from the final dragged position. Measured
  // from the dragged selection's outermost member(s) along the guide's long
  // axis, not its bbox center — see collectSpacingGaps. The virtual point's
  // guide-axis coordinate is pinned to `draggedCenter` (i.e. exactly `value`,
  // like every matched candidate) so the drawn segment stays a straight line
  // along the long axis instead of cutting diagonally toward wherever that
  // member happens to sit on the *other* axes. Center-to-center guides only —
  // an edge line is a boundary, not a spacing row.
  const spacing: SpacingGap[] = [];
  for (const guide of guides) {
    if (guide.dashed) continue;
    const longAxis = longAxisFor(guide.axis, guide.matchedCenters, axisCount);
    const extremeValues = extremeAxisValues(draggedFinalPoints, longAxis);
    const virtualPoints = extremeValues.map(v => {
      const p = draggedCenter.slice();
      p[longAxis] = v;
      return p;
    });
    spacing.push(...collectSpacingGaps(longAxis, guide.matchedCenters, virtualPoints, tolerance[longAxis]!));
  }

  return { snappedDelta, snappedAxes, draggedCenter, guides, spacing };
}

/**
 * Projects a spacing gap onto the guide line it belongs to, so the drawn
 * segment (and its label) sits exactly ON the rendered guide instead of
 * cutting between the involved fixtures' true centers — which, with a third
 * axis, are only guaranteed to agree on the guide axis. Returns axis-parallel
 * endpoints: gap-axis coords from the gap, everything else from the guide's
 * dragged point (which by construction lies on the line). Falls back to
 * pinning against `from` when no owning guide is found.
 */
export function pinSpacingGap(
  gap: SpacingGap,
  guides: GuideLine[],
  eps: number,
): { from: number[]; to: number[] } {
  const guide = guides.find(
    g => !g.dashed && g.axis !== gap.axis && Math.abs(gap.from[g.axis]! - g.value) <= eps,
  );
  const base = guide ? guide.draggedPoint.slice() : gap.from.slice();
  const from = base.slice();
  from[gap.axis] = gap.from[gap.axis]!;
  const to = base.slice();
  to[gap.axis] = gap.to[gap.axis]!;
  return { from, to };
}

/** Fraction of all fixtures a plane must hold before its distance is force-shown. */
export const PLANE_DOMINANCE_FRACTION = 1 / 3;

/**
 * When many fixtures share one value along `axis` — a plane perpendicular to
 * the drag direction — and the dragged selection has left that plane, returns
 * the axis-parallel distance from the dragged point down to the plane. This is
 * what makes "everything sits on one level, pull one fixture off it" show a
 * measurement even though nothing is aligned on the other axes: the dominant
 * plane itself is the reference. Returns null when no cluster holds more than
 * `minFraction` of all context fixtures, or the dragged point still sits on it.
 *
 * `tolerance` groups near-equal values into one plane and also defines "still
 * on the plane" (distance within tolerance → nothing to show).
 */
export function dominantPlaneGap(
  session: AlignmentSession,
  draggedCenter: number[],
  axis: number,
  tolerance: number,
  minFraction = PLANE_DOMINANCE_FRACTION,
): SpacingGap | null {
  const values: number[] = [];
  for (const cand of session.candidates) {
    for (const pt of cand.points) values.push(pt[axis]!);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);

  // Largest cluster of values within `tolerance` of the cluster's start.
  let bestCount = 0;
  let bestSum = 0;
  let i = 0;
  while (i < values.length) {
    let j = i;
    let sum = 0;
    while (j < values.length && values[j]! - values[i]! <= tolerance) {
      sum += values[j]!;
      j++;
    }
    if (j - i > bestCount) {
      bestCount = j - i;
      bestSum = sum;
    }
    i = j;
  }

  if (bestCount <= values.length * minFraction) return null;
  const planeValue = bestSum / bestCount;
  const distance = Math.abs(draggedCenter[axis]! - planeValue);
  if (distance <= tolerance) return null; // dragged point is still on the plane

  const from = draggedCenter.slice();
  const to = draggedCenter.slice();
  to[axis] = planeValue;
  return { axis, from, to, distance };
}
