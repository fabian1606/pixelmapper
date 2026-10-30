/**
 * Input key aliases applied before an operation's Zod validation.
 *
 * `modifiers.add` takes the new modifier's id as `id`, while the ops that
 * address an existing modifier take `modifierId` (`modifierIds` for lists).
 * Callers mix them up, so `id` is accepted wherever the schema requires
 * `modifierId` (and `id` / `modifierId` wherever it requires `modifierIds`).
 * This is a key rename only — the schema still validates the value, and an
 * input without any of the keys fails with the canonical key in the message.
 *
 * Kept outside the schemas on purpose: a `z.preprocess` wrapper would turn
 * the JSON schema of the input into `{}` (transforms are unrepresentable).
 */
import { z } from 'zod';

/** True for plain objects (not arrays / null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Top-level keys of an object schema (empty for other schema types). */
function schemaKeys(schema: z.ZodType): Set<string> {
  return schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : new Set();
}

/**
 * Renames alias keys of `input` to the keys `schema` expects:
 * - `id` → `modifierId` when the schema has `modifierId` but no `id`;
 * - `modifierId` / `id` (string) → `modifierIds: [value]` when the schema has
 *   `modifierIds` but neither single key.
 * The canonical key wins when both are given. Other inputs are returned as is.
 */
export function normalizeInputAliases(schema: z.ZodType, input: unknown): unknown {
  if (!isRecord(input)) return input;
  const keys = schemaKeys(schema);
  if (keys.has('modifierId') && !keys.has('id') && 'id' in input && !('modifierId' in input)) {
    const { id, ...rest } = input;
    return { ...rest, modifierId: id };
  }
  if (keys.has('modifierIds') && !keys.has('modifierId') && !keys.has('id') && !('modifierIds' in input)) {
    const single = 'modifierId' in input ? 'modifierId' : 'id' in input ? 'id' : null;
    if (single && typeof input[single] === 'string') {
      const { [single]: value, ...rest } = input;
      return { ...rest, modifierIds: [value] };
    }
  }
  return input;
}
