/**
 * `fixtures.arrange` (ADR 0002 §4.2 catalog, plan A1.4; WP-J): place many
 * fixtures on a shape in one op — grid, line, circle/arc, distribute,
 * align — optionally rotating them so their heads run along / across the
 * shape. Geometry lives in `arrange-layout.ts`.
 *
 * Rotation convention (verified against `beamWorldPx` / `kindToWorld` in
 * `kind-host.ts`, which the 2D canvas, the layout packet and observe use):
 * a fixture's local +x maps to world +x at 0°, rotation is clockwise on the
 * y-down canvas. Multi-head fixtures lay out their heads along local +x
 * (OFL pixel grids, kind fixtures), so at 0° head 0 is on the left and the
 * heads run toward +x; at 90° they run top→bottom (+y).
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { MoveFixtureCommand, type FixturePositionSnapshot } from '~/components/engine/commands/move-fixture-command';
import { RotateFixtureCommand, type FixtureRotationSnapshot } from '~/components/engine/commands/rotate-fixture-command';
import type { Command } from '~/components/engine/composables/use-history';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import { LayoutSchema, distanceFromShape, layoutTargets, orderByPosition, type Layout, type LayoutItem, type LayoutTarget } from './arrange-layout';
import { findFixtures } from './fixtures';
import { FixtureIdSchema, fixtureNotFound } from './shared';

// ── Constants ───────────────────────────────────

/** Position tolerance of `verify` (normalized units). */
const EPS = 1e-6;
/** Two fixtures closer than this count as stacked on one spot. */
const SAME_SPOT = 1e-4;

// ── Head axis ───────────────────────────────────

/** Normalizes degrees into [0, 360). */
function normDeg(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6 % 360;
}

/**
 * Direction (degrees, fixture-local, 0 = local +x) from the first to the
 * last head of a fixture; 0 for single-head fixtures. Uses the kind offset
 * (`offsetPx`) when present, else the normalized beam placement scaled by
 * the fixture footprint — the inputs of `beamWorldPx`.
 */
export function localHeadAxis(f: Fixture): number {
  const first = f.beams[0];
  const last = f.beams[f.beams.length - 1];
  if (!first || !last || first === last) return 0;
  const p = (b: typeof first) => (b.offsetPx ?? { x: b.localX * f.fixtureSize.x, y: b.localY * f.fixtureSize.y });
  const a = p(first);
  const b = p(last);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

// ── Schema ──────────────────────────────────────

/** Input of `fixtures.arrange`. */
const ArrangeInputSchema = z.object({
  fixtureIds: z.array(FixtureIdSchema).optional().describe('Fixtures to arrange (combined with groupIds).'),
  groupIds: z.array(FixtureIdSchema).optional().describe('Groups whose fixtures (deep) are arranged.'),
  layout: LayoutSchema,
  order: z.enum(['position', 'given']).optional()
    .describe('"position" (default): fill the shape in the fixtures\' current spatial order (grid: reading order; line: along from→to; circle: clockwise). "given": in the order of fixtureIds, then groups.'),
  orient: z.enum(['keep', 'along', 'across']).optional()
    .describe('"keep" (default): rotation unchanged. "along": rotate each fixture so its heads run along the row / line / circle tangent / edge (head 0 first in layout direction). "across": perpendicular to it (+90°).'),
  rotation: z.number().optional().describe('Absolute yaw in degrees for every arranged fixture (only with orient "keep").'),
}).refine(i => (i.fixtureIds?.length ?? 0) + (i.groupIds?.length ?? 0) > 0, { message: 'pass fixtureIds and/or groupIds', path: ['fixtureIds'] })
  .refine(i => i.rotation === undefined || (i.orient ?? 'keep') === 'keep', { message: 'rotation and orient "along"/"across" exclude each other', path: ['rotation'] });

/** Output of `fixtures.arrange`. */
const ArrangeOutputSchema = z.object({
  placed: z.array(z.object({ fixtureId: FixtureIdSchema, x: z.number(), y: z.number(), rotation: z.number().optional() })),
});

// ── Helpers ─────────────────────────────────────

/** Live fixture model by id. */
function liveFixture(id: string | number): Fixture | undefined {
  return (useEngineStore().flatFixtures as Fixture[]).find(f => String(f.id) === String(id));
}

/** The fixtures to arrange (deduplicated, fixtureIds first, then groups in order). */
function resolveItems(read: CoreReadApi, input: { fixtureIds?: (string | number)[]; groupIds?: (string | number)[] }): LayoutItem[] {
  const all = read.fixtures();
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  const add = (id: string | number) => {
    const f = all.find(x => String(x.id) === String(id));
    if (!f) throw new Error(fixtureNotFound(id));
    if (seen.has(String(f.id))) return;
    seen.add(String(f.id));
    items.push({ id: f.id, x: f.x, y: f.y });
  };
  for (const id of input.fixtureIds ?? []) add(id);
  for (const g of input.groupIds ?? []) {
    const members = findFixtures(read, { groupId: g });
    if (!members.length && !read.groups().some(x => String(x.id) === String(g))) throw new Error(`group "${String(g)}" not found (use groups.list)`);
    for (const f of members) add(f.id);
  }
  return items;
}

/** Targets in arrange order. */
function computeTargets(read: CoreReadApi, input: z.output<typeof ArrangeInputSchema>): LayoutTarget[] {
  const items = resolveItems(read, input);
  const ordered = (input.order ?? 'position') === 'given' ? items : orderByPosition(items, input.layout);
  const targets = layoutTargets(ordered, input.layout);
  const outside = targets.filter(t => t.x < -EPS || t.x > 1 + EPS || t.y < -EPS || t.y > 1 + EPS);
  if (outside.length) throw new Error(`layout places ${outside.length} fixture(s) outside the 0–1 world (e.g. ${String(outside[0]!.id)} at ${outside[0]!.x.toFixed(3)}, ${outside[0]!.y.toFixed(3)}); shrink the radius / bounds / gap`);
  return targets;
}

/** Wanted rotation of a fixture for an orient mode, or undefined to keep. */
function targetRotation(f: Fixture, t: LayoutTarget, input: { orient?: string; rotation?: number }): number | undefined {
  if (input.rotation !== undefined) return normDeg(input.rotation);
  if (input.orient === 'along') return normDeg(t.along - localHeadAxis(f));
  if (input.orient === 'across') return normDeg(t.along + 90 - localHeadAxis(f));
  return undefined;
}

/** True for layouts that may legitimately stack fixtures (one coordinate kept). */
function keepsOneCoordinate(layout: Layout): boolean {
  return layout.type === 'align' || layout.type === 'distribute';
}

// ── Operation ───────────────────────────────────

/** `fixtures.arrange`. */
export const fixturesArrange = defineCoreOperation({
  id: 'fixtures.arrange',
  kind: 'mutation',
  description: [
    'Arrange many fixtures on a shape in one op: grid (rows × cols in a rectangle), line (from → to), circle / arc (center, radius, start/end angle), distribute (even spacing along x or y) or align (left/right/top/bottom/centerX/centerY). Optionally rotates them along / across the shape.',
    'Coordinates: normalized world 0–1, x left→right, y top→bottom on the 2D canvas (same space as fixtures.move). The default 3D camera looks from the bottom edge, so "front" (audience side) is conventionally high y and "back" low y. z (height) is kept.',
    'Targets: fixtureIds and/or groupIds (group members, deep). order "position" (default) fills the shape in the fixtures\' current spatial order (least travel); "given" uses the listed order, e.g. to keep numbered fixtures (Bar 1, Bar 2, …) in sequence.',
    'grid: rows/cols (one is enough; both omitted = about square), bounds { minX, minY, maxX, maxY } = the rectangle the outer fixtures sit on (default: their current bounding box; a single row sits on the vertical center), optional gap { x, y } = fixed spacing centered in the bounds. A shorter last row keeps the spacing and is centered. E.g. 11 fixtures with rows 2 → 6 + 5.',
    'circle/arc angles: degrees, 0 = right (+x), 90 = down (+y), clockwise; a full circle (default) spaces fixtures evenly without a duplicate end point, an arc includes both ends.',
    'Rotation convention: yaw in degrees, clockwise on the canvas. At 0° a multi-head fixture (LED bar, pixel strip) has head 0 on the left and its heads run toward +x; at 90° they run top→bottom. orient "along" rotates each fixture so its heads run in the layout direction (grid row → +x, line from → to, circle tangent clockwise, distribute axis, aligned edge); "across" is perpendicular (+90°); "keep" (default) leaves rotation alone; or set `rotation` (absolute degrees) for all. Single-head fixtures count as pointing along local +x.',
    'Produces one MoveFixture (+ one RotateFixture when rotating). verify: every fixture on its target / the shape (±1e-6) and no two fixtures on the same spot (grid/line/circle). Fails without changes when the shape leaves 0–1.',
  ].join('\n'),
  input: ArrangeInputSchema,
  output: ArrangeOutputSchema,
  produces: ['MoveFixture', 'RotateFixture'],
  examples: [
    { input: { fixtureIds: ['bar-1', 'bar-2', 'bar-3', 'bar-4', 'bar-5', 'bar-6', 'bar-7', 'bar-8', 'bar-9', 'bar-10'], layout: { type: 'grid', rows: 2, bounds: { minX: 0.2, minY: 0.8, maxX: 0.8, maxY: 0.9 } }, orient: 'along' }, note: '10 bars in two rows of five at the front, heads running left to right.' },
    { input: { groupIds: ['g-ring'], layout: { type: 'circle', center: { x: 0.5, y: 0.5 }, radius: 0.3 }, orient: 'along' }, note: 'A group on a circle, heads following the circle.' },
    { input: { fixtureIds: ['fx-1', 'fx-2', 'fx-3'], layout: { type: 'line', from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.2 } } }, note: 'Three fixtures evenly on a line.' },
    { input: { fixtureIds: ['fx-1', 'fx-2', 'fx-3'], layout: { type: 'align', edge: 'top' } }, note: 'Align to the topmost fixture.' },
  ],
  run(ctx, input) {
    const targets = computeTargets(ctx.read, input);
    const fixtures: Fixture[] = [];
    const before: FixturePositionSnapshot[] = [];
    const after: FixturePositionSnapshot[] = [];
    const rotBefore: FixtureRotationSnapshot[] = [];
    const rotAfter: FixtureRotationSnapshot[] = [];
    const placed: z.output<typeof ArrangeOutputSchema>['placed'] = [];
    for (const t of targets) {
      const f = liveFixture(t.id);
      if (!f) throw new Error(fixtureNotFound(t.id));
      fixtures.push(f);
      before.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ });
      after.push({ id: f.id, x: t.x, y: t.y, z: f.positionZ });
      const rotation = targetRotation(f, t, input);
      if (rotation !== undefined) {
        rotBefore.push({ id: f.id, rotation: f.rotation });
        rotAfter.push({ id: f.id, rotation });
      }
      placed.push({ fixtureId: f.id, x: t.x, y: t.y, ...(rotation !== undefined ? { rotation } : {}) });
    }
    const commands: Command[] = [new MoveFixtureCommand(fixtures, before, after)];
    if (rotAfter.length) commands.push(new RotateFixtureCommand(fixtures.filter(f => rotAfter.some(r => r.id === f.id)), rotBefore, rotAfter));
    return { kind: 'mutation', commands, value: { placed } };
  },
  verify(ctx, input, value) {
    const findings: Finding[] = [];
    const targets: LayoutTarget[] = value.placed.map(p => ({ id: p.fixtureId, x: p.x, y: p.y, along: 0 }));
    const now = value.placed.map(p => ({ p, f: ctx.read.fixture(p.fixtureId) }));
    for (const { p, f } of now) {
      const off = !f || Math.abs(f.x - p.x) > EPS || Math.abs(f.y - p.y) > EPS || distanceFromShape(f, input.layout, targets) > EPS;
      if (off) findings.push({ level: 'error', code: 'arrange-not-applied', message: `fixture ${String(p.fixtureId)} is not on the ${input.layout.type} target`, entityIds: [`fixture:${String(p.fixtureId)}`] });
      else if (p.rotation !== undefined && Math.abs(normDeg(f.rotation) - p.rotation) > 1e-6) findings.push({ level: 'error', code: 'arrange-not-rotated', message: `fixture ${String(p.fixtureId)} did not reach rotation ${p.rotation}°`, entityIds: [`fixture:${String(p.fixtureId)}`] });
    }
    // Stacked fixtures: an error for shapes that place every fixture, a warning for align/distribute.
    for (let i = 0; i < value.placed.length; i++) {
      for (let j = i + 1; j < value.placed.length; j++) {
        const a = value.placed[i]!;
        const b = value.placed[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= SAME_SPOT) continue;
        findings.push({
          level: keepsOneCoordinate(input.layout) ? 'warning' : 'error', code: 'arrange-overlap',
          message: `fixtures ${String(a.fixtureId)} and ${String(b.fixtureId)} end up on the same spot (${a.x.toFixed(3)}, ${a.y.toFixed(3)})`,
          entityIds: [`fixture:${String(a.fixtureId)}`, `fixture:${String(b.fixtureId)}`],
        });
      }
    }
    return findings;
  },
});
