/**
 * The `apply` envelope (WP-J): how one operation is embedded in a batch.
 *
 * A batch op is `{ op: "<operation id>", input: { …the operation's input… } }`.
 * Agents often put the input keys next to `op` instead (`{ op, moves }`).
 * `normalizeApplyRequest` accepts that lenient form by folding the extra
 * keys into `input` (plus `params` / `args` / `arguments` as aliases of
 * `input`, and a single top-level `{ op, input }` without `ops`), and
 * returns an `info` finding that names the canonical shape. An entry with
 * `input` AND extra keys stays ambiguous and fails with a hint.
 *
 * The module also renders the shape for humans/agents: a one-line input
 * summary from an operation's JSON schema and a ready-to-copy apply call.
 */
import type { Finding } from './finding';
import type { OperationDescription } from './operation';

// ── Constants ───────────────────────────────────

/** One-line reminder of the apply call shape (tool descriptions, listings, errors). */
export const APPLY_ENVELOPE = 'apply { "label": "…", "ops": [ { "op": "<operation id>", "input": { …that operation\'s input… } } ], "dryRun"?: true, "expect"?: […] }';

/** Keys accepted instead of `input` on a batch op. */
const INPUT_ALIASES = ['params', 'args', 'arguments'] as const;

/** Keys of a batch op entry itself. */
const ENTRY_KEYS = new Set(['op', 'input']);

// ── Helpers ─────────────────────────────────────

/** True for plain objects (not arrays / null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Backticked, comma-separated key list. */
function keyList(keys: readonly string[]): string {
  return keys.map(k => `\`${k}\``).join(', ');
}

// ── Normalization ───────────────────────────────

/** Result of {@link normalizeApplyRequest}. */
export interface NormalizedApplyRequest {
  /** The request with canonical `{ op, input }` entries (unchanged when already canonical). */
  request: unknown;
  /** `info` notes about folded keys, `error` findings for ambiguous entries. */
  findings: Finding[];
}

/** Normalizes one op entry; see module docs. */
function normalizeEntry(entry: unknown, index: number, findings: Finding[]): unknown {
  if (!isRecord(entry) || typeof entry.op !== 'string') return entry;
  const op = entry.op;
  const extra = Object.keys(entry).filter(k => !ENTRY_KEYS.has(k));
  if (!extra.length) return entry;
  const alias = INPUT_ALIASES.find(a => a in entry);
  if (!('input' in entry) && alias && extra.length === 1) {
    findings.push({ level: 'info', code: 'input-alias', opIndex: index, message: `op ${index} (${op}): read \`${alias}\` as \`input\`. Canonical entry: { "op": "${op}", "input": { … } }.` });
    return { op, input: entry[alias] };
  }
  if ('input' in entry) {
    findings.push({
      level: 'error', code: 'invalid-envelope', opIndex: index,
      message: `op ${index} (${op}): unexpected key(s) ${keyList(extra)} next to \`input\`. Op entries are { "op", "input" } only; put ${keyList(extra)} inside \`input\` (see describe { "id": "${op}" }).`,
    });
    return entry;
  }
  // Lenient form: the op's input keys sit next to `op`; fold them into `input`.
  const input = Object.fromEntries(extra.map(k => [k, entry[k]]));
  findings.push({
    level: 'info', code: 'input-folded', opIndex: index,
    message: `op ${index} (${op}): moved ${keyList(extra)} into \`input\`. Canonical entry: { "op": "${op}", "input": { ${extra.map(k => `"${k}": …`).join(', ')} } }.`,
  });
  return { op, input };
}

/**
 * Brings an apply request into the canonical envelope (see module docs).
 * Idempotent: a canonical request comes back unchanged without findings.
 */
export function normalizeApplyRequest(raw: unknown): NormalizedApplyRequest {
  const findings: Finding[] = [];
  if (!isRecord(raw)) return { request: raw, findings };
  let request: Record<string, unknown> = raw;
  // A single op at the top level (`{ label, op, input }`) becomes a one-op batch.
  if (!('ops' in raw) && typeof raw.op === 'string') {
    const { op, input, label, dryRun, expect, ...rest } = raw;
    request = { label, dryRun, expect, ops: [{ op, ...(input !== undefined ? { input } : {}), ...rest }] };
    for (const k of ['label', 'dryRun', 'expect']) if (request[k] === undefined) delete request[k];
    findings.push({ level: 'info', code: 'ops-wrapped', message: `Read the top-level \`op\` as a one-op batch. Canonical: ${APPLY_ENVELOPE}.` });
  }
  if (!Array.isArray(request.ops)) return { request, findings };
  const ops = request.ops.map((entry, i) => normalizeEntry(entry, i, findings));
  return { request: { ...request, ops }, findings };
}

// ── Rendering ───────────────────────────────────

/** JSON schema node (loosely typed). */
type SchemaNode = Record<string, unknown>;

/** Readable type of a schema node, one level into objects/arrays (`depth` bounds recursion). */
function typeOf(node: SchemaNode | undefined, depth: number): string {
  if (!node) return 'any';
  if (Array.isArray(node.enum)) return node.enum.map(v => JSON.stringify(v)).join(' | ');
  if ('const' in node) return JSON.stringify(node.const);
  const variants = (node.anyOf ?? node.oneOf) as SchemaNode[] | undefined;
  if (Array.isArray(variants)) return [...new Set(variants.map(v => typeOf(v, depth)))].join(' | ');
  if (node.type === 'array') return `${typeOf(node.items as SchemaNode | undefined, depth)}[]`;
  if (node.type === 'object' && isRecord(node.properties)) return depth > 0 ? objectSummary(node, depth - 1) : 'object';
  return typeof node.type === 'string' ? node.type : Array.isArray(node.type) ? node.type.join(' | ') : 'any';
}

/** `{ a: string, b?: number }` of an object schema node. */
function objectSummary(node: SchemaNode, depth: number): string {
  const props = (node.properties ?? {}) as Record<string, SchemaNode>;
  const required = new Set((node.required ?? []) as string[]);
  const parts = Object.entries(props).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${typeOf(v, depth)}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/**
 * One-line summary of an input JSON schema: `{ moves: { fixtureId: string | number, x?: number }[] }`
 * (`?` = optional). Nested objects are expanded two levels deep.
 */
export function summarizeInputSchema(schema: Record<string, unknown>): string {
  return schema.type === 'object' ? objectSummary(schema, 2) : typeOf(schema, 2);
}

/** Required top-level keys of an input JSON schema. */
export function requiredKeys(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required) ? schema.required.map(String) : [];
}

/** Placeholder input built from the required keys when an operation has no example. */
function placeholderInput(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, SchemaNode>;
  return Object.fromEntries(requiredKeys(schema).map(k => [k, `<${typeOf(props[k], 0)}>`]));
}

/**
 * Ready-to-copy call for an operation, built from its first example:
 * `apply { label, ops: [{ op, input }] }` for mutations/actions, `inspect
 * { selector: { op, input } }` for queries (which also run inside apply).
 */
export function exampleCall(description: Pick<OperationDescription, 'id' | 'kind' | 'examples' | 'inputSchema' | 'summary'>): { tool: 'apply' | 'inspect'; input: Record<string, unknown> } {
  const input = description.examples[0]?.input ?? placeholderInput(description.inputSchema);
  if (description.kind === 'query') return { tool: 'inspect', input: { selector: { op: description.id, input } } };
  const label = description.examples[0]?.note?.replace(/\.$/, '') ?? description.id;
  return { tool: 'apply', input: { label: label.slice(0, 60), ops: [{ op: description.id, input }] } };
}

/** Text block of {@link exampleCall} for `describe`. */
export function exampleCallText(description: Parameters<typeof exampleCall>[0]): string {
  const call = exampleCall(description);
  const how = call.tool === 'apply'
    ? `Call it through \`apply\`; the operation's input goes INSIDE "input" (op entries are { "op", "input" }):`
    : 'Run it with `inspect` (or as an op inside `apply`, same { "op", "input" } entry):';
  return `${how}\n${call.tool} ${JSON.stringify(call.input)}`;
}
