/**
 * Fixture operations: `fixtures.find`, `fixtures.get`, `fixtures.move`,
 * `fixtures.rotate`, `fixtures.setKindConfig` (ADR 0002 §4.2, B3).
 *
 * Coordinates are normalized world space 0–1: `x` left→right, `y`
 * top→bottom on the 2D canvas (the same space as plugin `Sample.x/y`), `z`
 * = height above the floor normalized like x/y.
 */
import { z } from 'zod';
import type { Json } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { MoveFixtureCommand, type FixturePositionSnapshot } from '~/components/engine/commands/move-fixture-command';
import { RotateFixtureCommand } from '~/components/engine/commands/rotate-fixture-command';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { headSamples } from '~/utils/observability/targets';
import { defineCoreOperation } from '../define';
import type { CoreReadApi, FixtureInfo } from '../read-api';
import { FixtureIdSchema, FixtureInfoSchema, SignatureSchema, Unit, fixtureNotFound } from './shared';

// ── Filter ──────────────────────────────────────

/** Fixture filter shared by `fixtures.find` (all fields AND-combined). */
export const FixtureFilterSchema = z.object({
  ids: z.array(FixtureIdSchema).optional().describe('Only these fixture ids.'),
  kind: z.string().optional().describe('Fixture kind id (generated fixtures) or OFL key substring, e.g. "neopixel-strip" or "generic/drgb".'),
  signature: SignatureSchema.optional().describe('Fixtures offering this signature: "rgb" (color), "panTilt" (moving heads), "scalar" (any channel).'),
  channelType: z.string().optional().describe('Fixtures with a channel of this type, e.g. "DIMMER", "WHITE", "STROBE".'),
  groupId: FixtureIdSchema.optional().describe('Fixtures inside this group (deep).'),
  name: z.string().optional().describe('Case-insensitive substring of the fixture name.'),
  bbox: z.object({ minX: Unit, minY: Unit, maxX: Unit, maxY: Unit }).optional()
    .describe('Normalized world rectangle (0–1, inclusive) the fixture position must lie in.'),
});

/** Filter type. */
export type FixtureFilter = z.infer<typeof FixtureFilterSchema>;

/** Applies a filter to the fixtures of the read API. */
export function findFixtures(read: CoreReadApi, filter: FixtureFilter): FixtureInfo[] {
  const ids = filter.ids ? new Set(filter.ids.map(String)) : null;
  const name = filter.name?.toLowerCase();
  return read.fixtures().filter(f =>
    (!ids || ids.has(String(f.id)))
    && (!filter.kind || f.kind === filter.kind || (f.oflKey ?? '').includes(filter.kind))
    && (!filter.signature || f.signatures.includes(filter.signature))
    && (!filter.channelType || f.channelTypes.includes(filter.channelType as never))
    && (filter.groupId === undefined || f.groupIds.map(String).includes(String(filter.groupId)))
    && (!name || f.name.toLowerCase().includes(name))
    && (!filter.bbox || (f.x >= filter.bbox.minX && f.x <= filter.bbox.maxX && f.y >= filter.bbox.minY && f.y <= filter.bbox.maxY)));
}

/** Live fixture model by id (for command construction). */
function liveFixture(id: string | number): Fixture | undefined {
  return (useEngineStore().flatFixtures as Fixture[]).find(f => String(f.id) === String(id));
}

/** Resolves the stored id (string vs. numeric legacy ids) of a fixture. */
function resolveId(read: CoreReadApi, id: string | number): string | number | null {
  return read.fixtures().find(f => String(f.id) === String(id))?.id ?? null;
}

// ── Queries ─────────────────────────────────────

/** `fixtures.find`. */
export const fixturesFind = defineCoreOperation({
  id: 'fixtures.find',
  kind: 'query',
  description: [
    'Find fixtures by ids, kind, signature, channel type, group, name or bounding box (all filters AND-combined; empty filter = all).',
    'Returns compact fixture views: id, name, kind, x/y/z (normalized world 0–1; x left→right, y top→bottom as on the 2D canvas, same space as plugin Sample.x/y; z = height), rotation (degrees), heads (pixel/beam count), signatures, channelTypes, groupIds, universe, address.',
  ].join('\n'),
  input: FixtureFilterSchema,
  output: z.object({ fixtures: z.array(FixtureInfoSchema) }),
  examples: [
    { input: { signature: 'rgb' }, note: 'All color-capable fixtures.' },
    { input: { bbox: { minX: 0, minY: 0, maxX: 0.5, maxY: 1 } }, note: 'Fixtures on the left half of the stage.' },
  ],
  run: (ctx, input) => ({ kind: 'query', value: { fixtures: findFixtures(ctx.read, input) } }),
});

/** World position of one engine head (normalized, as plugin `Sample.x/y`). */
interface HeadPosition {
  head: number;
  /** Beam that owns the head's channels (absent for a fixture-level head). */
  beamId?: string;
  x: number;
  y: number;
}

/**
 * Engine heads of a fixture with their world positions exactly as the
 * layout packet sends them (beam offset rotated by the fixture rotation,
 * fixture-level heads at the fixture position).
 */
function headPositions(f: Fixture): HeadPosition[] {
  return headSamples([f], [f], () => []).map((h) => {
    const beam = f.beams[h.head];
    const owns = !!beam && f.channels.some(c => c.beamId === beam.id);
    return { head: h.head, ...(owns ? { beamId: beam.id } : {}), x: Number(h.x.toFixed(4)), y: Number(h.y.toFixed(4)) };
  });
}

/** `fixtures.get`. */
export const fixturesGet = defineCoreOperation({
  id: 'fixtures.get',
  kind: 'query',
  description: [
    'Full detail of fixtures by id: compact view plus channels (index, type, DMX address, current programmed value 0–255, range), heads, beams, kind config and extension data.',
    'Positions are normalized world 0–1 (x left→right, y top→bottom, z = height).',
    'detail.heads: one entry per engine head/pixel in head order (= patch order, the head index observe uses) with its world x/y — the same space as plugin Sample.x/y; use these for room boxes and pixel order.',
    'detail.beams: local beam offsets {x, y, z} in fixture-local units (1 = one fixture footprint, 36 px × fixture size, along the fixture\'s own unrotated axes; +x = towards the fixture\'s right before rotation). World = fixture position + offset rotated clockwise by `rotation`. Prefer detail.heads over computing this yourself.',
  ].join('\n'),
  input: z.object({ ids: z.array(FixtureIdSchema).min(1) }),
  output: z.object({ fixtures: z.array(z.unknown()), missing: z.array(FixtureIdSchema) }),
  examples: [{ input: { ids: ['fx-1'] } }],
  run(ctx, input) {
    const fixtures: unknown[] = [];
    const missing: Array<string | number> = [];
    for (const raw of input.ids) {
      const id = resolveId(ctx.read, raw);
      const detail = id === null ? null : ctx.read.fixtureDetail(id);
      const live = id === null ? undefined : liveFixture(id);
      if (detail && id !== null) fixtures.push({ ...ctx.read.fixture(id), detail: { ...detail, heads: live ? headPositions(live) : [] } });
      else missing.push(raw);
    }
    return { kind: 'query', value: { fixtures, missing } };
  },
});

// ── Mutations ───────────────────────────────────

/** `fixtures.move`. */
export const fixturesMove = defineCoreOperation({
  id: 'fixtures.move',
  kind: 'mutation',
  description: [
    'Move fixtures to absolute positions (normalized world 0–1: x left→right, y top→bottom on the 2D canvas, same space as plugin Sample.x/y; optional z = height above the floor, normalized like x/y).',
    'Omitted coordinates keep their current value. One MoveFixture command for all moves.',
  ].join('\n'),
  input: z.object({
    moves: z.array(z.object({
      fixtureId: FixtureIdSchema,
      x: Unit.optional(),
      y: Unit.optional(),
      z: z.number().min(0).optional().describe('Height, normalized like x/y.'),
    })).min(1),
  }),
  output: z.object({ moved: z.array(FixtureIdSchema) }),
  produces: ['MoveFixture'],
  examples: [{ input: { moves: [{ fixtureId: 'fx-1', x: 0.25, y: 0.5 }] }, note: 'Move one fixture to the left-center.' }],
  run(_ctx, input) {
    const fixtures: Fixture[] = [];
    const before: FixturePositionSnapshot[] = [];
    const after: FixturePositionSnapshot[] = [];
    for (const m of input.moves) {
      const f = liveFixture(m.fixtureId);
      if (!f) throw new Error(fixtureNotFound(m.fixtureId));
      fixtures.push(f);
      before.push({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y, z: f.positionZ });
      after.push({ id: f.id, x: m.x ?? f.fixturePosition.x, y: m.y ?? f.fixturePosition.y, z: m.z ?? f.positionZ });
    }
    return { kind: 'mutation', commands: [new MoveFixtureCommand(fixtures, before, after)], value: { moved: fixtures.map(f => f.id) } };
  },
  verify(ctx, input) {
    return input.moves.flatMap((m) => {
      const f = ctx.read.fixture(resolveId(ctx.read, m.fixtureId) ?? m.fixtureId);
      const ok = f && (m.x === undefined || Math.abs(f.x - m.x) < 1e-9) && (m.y === undefined || Math.abs(f.y - m.y) < 1e-9);
      return ok ? [] : [{ level: 'error' as const, code: 'move-not-applied', message: `fixture ${m.fixtureId} did not reach its target position`, entityIds: [`fixture:${m.fixtureId}`] }];
    });
  },
});

/** `fixtures.rotate`. */
export const fixturesRotate = defineCoreOperation({
  id: 'fixtures.rotate',
  kind: 'mutation',
  description: 'Set the yaw rotation of fixtures in degrees (0–360, clockwise on the 2D canvas). One RotateFixture command for all fixtures.',
  input: z.object({
    rotations: z.array(z.object({ fixtureId: FixtureIdSchema, rotation: z.number().describe('Degrees; normalized into 0–360.') })).min(1),
  }),
  output: z.object({ rotated: z.array(FixtureIdSchema) }),
  produces: ['RotateFixture'],
  examples: [{ input: { rotations: [{ fixtureId: 'fx-1', rotation: 90 }] } }],
  run(_ctx, input) {
    const fixtures: Fixture[] = [];
    const before: { id: string | number; rotation: number }[] = [];
    const after: { id: string | number; rotation: number }[] = [];
    for (const r of input.rotations) {
      const f = liveFixture(r.fixtureId);
      if (!f) throw new Error(fixtureNotFound(r.fixtureId));
      fixtures.push(f);
      before.push({ id: f.id, rotation: f.rotation });
      after.push({ id: f.id, rotation: ((r.rotation % 360) + 360) % 360 });
    }
    return { kind: 'mutation', commands: [new RotateFixtureCommand(fixtures, before, after)], value: { rotated: fixtures.map(f => f.id) } };
  },
});

/** `fixtures.setKindConfig`. */
export const fixturesSetKindConfig = defineCoreOperation({
  id: 'fixtures.setKindConfig',
  kind: 'mutation',
  description: [
    'Replace the config of a generated (kind) fixture, e.g. a LED strip\'s pixel count or shape, and rebuild it. Only for fixtures with a `kind` (see fixtures.find).',
    'Read the current config with fixtures.get first; the config is the kind\'s JSON, replaced as a whole.',
  ].join('\n'),
  input: z.object({ fixtureId: FixtureIdSchema, config: z.unknown().describe('Complete kind config (JSON).') }),
  output: z.object({ fixtureId: FixtureIdSchema }),
  produces: ['SetFixtureKindConfig'],
  run(ctx, input) {
    const id = resolveId(ctx.read, input.fixtureId);
    if (id === null) throw new Error(fixtureNotFound(input.fixtureId));
    const cmd = createCoreCommandFactory().setFixtureKindConfig({ fixtureId: id, config: input.config as Json });
    return { kind: 'mutation', commands: [cmd], value: { fixtureId: id } };
  },
});

/** All fixture operations. */
export const fixtureOperations = [fixturesFind, fixturesGet, fixturesMove, fixturesRotate, fixturesSetKindConfig];
