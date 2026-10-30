/**
 * Input key aliases applied before an operation's Zod validation.
 *
 * `modifiers.add` takes the new modifier's id as `id`, while the ops that
 * address an existing modifier take `modifierId` (`modifierIds` for lists).
 * Callers mix them up, so `id` is accepted wherever the schema requires
 * `modifierId` (and `id` / `modifierId` wherever it requires `modifierIds`).
 * This is a key rename only — the schema still validates the value, and an
 * input without any of the keys fails with the canonical key in the message.
 * The canonical key and its alias may both be given only when they name the
 * same id; otherwise the input is rejected (the caller's intent is unclear).
 *
 * Kept outside the schemas on purpose: a `z.preprocess` wrapper would turn
 * the JSON schema of the input into `{}` (transforms are unrepresentable).
 */
import { z } from 'zod';

/** Result of {@link normalizeInputAliases}: the renamed input or a readable conflict. */
export type AliasResult = { ok: true; input: unknown } | { ok: false; message: string };

/** True for plain objects (not arrays / null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Top-level keys of an object schema (empty for other schema types). */
function schemaKeys(schema: z.ZodType): Set<string> {
  return schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : new Set();
}

/** JSON text of a value for error messages. */
const show = (v: unknown): string => JSON.stringify(v) ?? String(v);

/** `input` without `key` (new object). */
function without(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _dropped, ...rest } = input;
  return rest;
}

/** Same id list (order-sensitive; scalar ids compared as strings). */
function sameIds(a: unknown, b: unknown): boolean {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(String);
  const [x, y] = [list(a), list(b)];
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/** `modifierId` with its alias `id` (schema has `modifierId`, no `id`). */
function singleAlias(input: Record<string, unknown>): AliasResult {
  if (!('id' in input)) return { ok: true, input };
  if (!('modifierId' in input)) return { ok: true, input: { ...without(input, 'id'), modifierId: input.id } };
  // Both keys: fine when they agree (drop the alias), a conflict otherwise.
  if (input.id === input.modifierId) return { ok: true, input: without(input, 'id') };
  return {
    ok: false,
    message: `modifierId ${show(input.modifierId)} and its alias id ${show(input.id)} name different modifiers; pass only \`modifierId\``,
  };
}

/** `modifierIds` with the single aliases `modifierId` / `id` (schema has `modifierIds` only). */
function listAlias(input: Record<string, unknown>): AliasResult {
  const singles = (['modifierId', 'id'] as const).filter(k => k in input);
  if (singles.length === 0) return { ok: true, input };
  // Every given key must name the same id(s); the first present one is the value.
  const keys = ['modifierIds', ...singles].filter(k => k in input);
  const values = keys.map(k => input[k]);
  if (values.some(v => !sameIds(v, values[0]))) {
    const given = keys.map(k => `${k} ${show(input[k])}`).join(', ');
    return { ok: false, message: `${given} name different modifiers; pass only \`modifierIds\` (a single \`modifierId\` or \`id\` is accepted as alias)` };
  }
  let rest: Record<string, unknown> = input;
  for (const k of singles) rest = without(rest, k);
  const value = values[0];
  return { ok: true, input: { ...rest, modifierIds: Array.isArray(value) ? value : [value] } };
}

/**
 * Renames alias keys of `input` to the keys `schema` expects:
 * - `id` → `modifierId` when the schema has `modifierId` but no `id`;
 * - `modifierId` / `id` (an id or id list) → `modifierIds` when the schema
 *   has `modifierIds` but neither single key.
 * When the canonical key and an alias are both given they must name the same
 * id(s), else the result is a conflict message. Other inputs pass unchanged.
 */
export function normalizeInputAliases(schema: z.ZodType, input: unknown): AliasResult {
  if (!isRecord(input)) return { ok: true, input };
  const keys = schemaKeys(schema);
  if (keys.has('modifierId') && !keys.has('id')) return singleAlias(input);
  if (keys.has('modifierIds') && !keys.has('modifierId') && !keys.has('id')) return listAlias(input);
  return { ok: true, input };
}
