/**
 * Project operations: `project.digest`, `project.setBpm` (ADR 0002 §4.2).
 */
import { z } from 'zod';
import { SetBpmCommand } from '~/components/engine/commands/set-bpm-command';
import { modifierName } from '~/utils/engine/modifiers';
import { defineCoreOperation } from '../define';
import { FixtureIdSchema, SignatureSchema } from './shared';
import { findPlugin } from './plugin-ref';
import { OrientationSchema, ROTATION_CONVENTION, orientationField } from './orientation';

// ── Digest ──────────────────────────────────────

/** Compact fixture row of the digest. */
const DigestFixtureSchema = z.object({
  id: FixtureIdSchema,
  name: z.string(),
  kind: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rotation: z.number().describe('Yaw in degrees, clockwise on the 2D canvas.'),
  orientation: OrientationSchema.optional(),
  heads: z.number(),
  signatures: z.array(SignatureSchema),
  groupIds: z.array(FixtureIdSchema),
});

/** Rounds to 3 decimals (keeps the digest compact). */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** `project.digest`. */
export const projectDigest = defineCoreOperation({
  id: 'project.digest',
  kind: 'query',
  description: [
    'Compact overview of the project: BPM, fixtures, groups, the modifier stack and live pages. Start every task with it.',
    'Fixtures: id, name, kind (generated fixture kind, if any), x/y/z in normalized world space 0–1 (x left→right, y top→bottom on the 2D canvas, same space as plugin Sample.x/y; z = height above the floor normalized like x/y; rounded to 3 decimals), rotation (degrees), orientation (multi-head fixtures: runs "left→right" | "top→bottom" | …, axis { dx, dy }, firstHead / lastHead world x/y), heads (pixel/beam count), signatures (rgb = color, panTilt = moving head, scalar = any channel), groupIds.',
    ROTATION_CONVENTION,
    'To see the layout instead of reading coordinates, call the `screenshot` tool (if available).',
    'Modifiers: id, plugin alias/name, signature, number of targeted fixtures (null = all), strength, blend. Use modifiers.list / fixtures.get / live.listPages for details.',
  ].join('\n'),
  input: z.object({}),
  output: z.object({
    bpm: z.number(),
    fixtureCount: z.number(),
    fixtures: z.array(DigestFixtureSchema),
    groups: z.array(z.object({ id: FixtureIdSchema, name: z.string(), parentId: FixtureIdSchema.nullable(), fixtureCount: z.number() })),
    modifiers: z.array(z.object({
      id: z.string(),
      plugin: z.string(),
      name: z.string(),
      signature: SignatureSchema,
      targetCount: z.number().nullable(),
      strength: z.number(),
      blend: z.string(),
    })),
    livePages: z.array(z.object({ id: z.string(), name: z.string(), widgetCount: z.number() })),
  }),
  examples: [{ input: {} }],
  run(ctx) {
    const fixtures = ctx.read.fixtures().map(f => ({
      id: f.id, name: f.name, kind: f.kind, x: r3(f.x), y: r3(f.y), z: r3(f.z),
      rotation: r3(f.rotation), ...orientationField(f.id),
      heads: f.heads, signatures: f.signatures, groupIds: f.groupIds,
    }));
    const modifiers = ctx.read.modifiers().map((m) => {
      const resolved = findPlugin(m.plugin);
      return {
        id: m.id,
        plugin: resolved?.manifest.alias ?? m.plugin,
        name: modifierName(m),
        signature: m.signature,
        targetCount: m.targetFixtureIds ? m.targetFixtureIds.length : null,
        strength: m.strength,
        blend: m.blendMode,
      };
    });
    return {
      kind: 'query',
      value: {
        bpm: ctx.read.bpm(),
        fixtureCount: fixtures.length,
        fixtures,
        groups: ctx.read.groups().map(g => ({ id: g.id, name: g.name, parentId: g.parentId, fixtureCount: g.fixtureIds.length })),
        modifiers,
        livePages: ctx.read.livePages().map(p => ({ id: p.id, name: p.name, widgetCount: p.widgets.length })),
      },
    };
  },
});

// ── BPM ─────────────────────────────────────────

/** `project.setBpm`. */
export const projectSetBpm = defineCoreOperation({
  id: 'project.setBpm',
  kind: 'mutation',
  description: [
    'Set the project tempo in beats per minute (20–300). Beat-synced modifiers (speed mode "beat") follow it.',
    'Undoable; collaborators receive it as the engine.bpm live change.',
  ].join('\n'),
  input: z.object({ bpm: z.number().min(20).max(300) }),
  output: z.object({ bpm: z.number(), previous: z.number() }),
  examples: [{ input: { bpm: 128 } }],
  run(ctx, input) {
    const previous = ctx.read.bpm();
    return { kind: 'mutation', commands: [new SetBpmCommand(previous, input.bpm)], value: { bpm: input.bpm, previous } };
  },
  verify(ctx, input) {
    return ctx.read.bpm() === input.bpm ? [] : [{ level: 'error', code: 'bpm-not-applied', message: `BPM is ${ctx.read.bpm()}, expected ${input.bpm}` }];
  },
});

/** All project operations. */
export const projectOperations = [projectDigest, projectSetBpm];
