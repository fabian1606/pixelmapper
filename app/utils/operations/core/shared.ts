/**
 * Zod building blocks shared by the core operations.
 */
import { z } from 'zod';

/** Fixture / node id (string ids; numeric legacy ids are accepted). */
export const FixtureIdSchema = z.union([z.string(), z.number()]).describe('Fixture or scene node id.');

/** A normalized coordinate 0–1. */
export const Unit = z.number().min(0).max(1);

/** Modifier signature. */
export const SignatureSchema = z.enum(['scalar', 'rgb', 'panTilt']);

/** Compact fixture view (see `FixtureInfo` in `read-api.ts`). */
export const FixtureInfoSchema = z.object({
  id: FixtureIdSchema,
  name: z.string(),
  kind: z.string().optional(),
  oflKey: z.string().optional(),
  x: z.number().describe('Normalized world x 0–1 (left→right).'),
  y: z.number().describe('Normalized world y 0–1 (top→bottom on the 2D canvas).'),
  z: z.number().describe('Height above the floor, normalized like x/y.'),
  rotation: z.number().describe('Yaw in degrees.'),
  heads: z.number().int().describe('Number of heads / pixels.'),
  signatures: z.array(SignatureSchema),
  channelTypes: z.array(z.string()),
  groupIds: z.array(FixtureIdSchema),
  universe: z.number().int(),
  address: z.number().int(),
  channelCount: z.number().int(),
});

/** Readable "not found" message. */
export function fixtureNotFound(id: string | number): string {
  return `fixture "${String(id)}" not found (use fixtures.find to list ids)`;
}

/**
 * Modifier id input (`modifierId`; the transaction runner also accepts `id`
 * as alias, see `input-aliases.ts`). A missing value names the right key.
 */
export const ModifierIdSchema = z.string({
  error: iss => (iss.input === undefined ? 'required: pass the modifier id as "modifierId" ("id" is accepted as alias; see modifiers.list)' : undefined),
}).min(1).describe('Modifier instance id (see modifiers.list). Alias: "id".');

/** Readable "modifier not found" message. */
export function modifierNotFound(id: string): string {
  return `modifier "${id}" not found (use modifiers.list to list ids)`;
}
