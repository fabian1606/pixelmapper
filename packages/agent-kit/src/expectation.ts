/**
 * Expectations (ADR 0002 D10).
 *
 * An expectation is a small, generic assertion over a JSON subject: a dot
 * path plus one comparator. The same evaluator checks observation features
 * (`{ path: 'temporal.kind', eq: 'periodic' }`), apply results
 * (`{ path: 'state.bpm', eq: 128 }`) and anything else that is JSON.
 *
 * Paths:
 * - `a.b.c` walks object keys; numeric segments index arrays (`fixtures.0.x`);
 * - `*` expands every element / value (`fixtures.*.x`); the comparator then
 *   must hold for `all` matches (default) or `any` match (`quantifier`);
 * - `length` on an array yields its length.
 */
import { z } from 'zod';

// ── Types ───────────────────────────────────────

/** One assertion: `path` plus exactly one comparator. */
export interface Expectation {
  /** Dot path into the subject; see module docs. */
  path: string;
  /** Optional human label shown in reports (defaults to a generated one). */
  label?: string;
  /** With `*` in the path: comparator must hold for all (default) or any match. */
  quantifier?: 'all' | 'any';
  /** Deep equality. */
  eq?: unknown;
  /** Deep inequality. */
  ne?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  /** Inclusive numeric range `[min, max]`. */
  within?: [number, number];
  /** Value is deep-equal to one of these. */
  oneOf?: unknown[];
  /** String contains substring, or array contains a deep-equal element. */
  contains?: unknown;
  /** `true`: path resolves to a defined value; `false`: it does not. */
  exists?: boolean;
}

/** Result of one expectation. */
export interface ExpectationResult {
  expectation: Expectation;
  pass: boolean;
  /** Resolved value(s) at the path (array when the path has `*`). */
  actual: unknown;
  /** Readable one-liner, e.g. `✓ temporal.hz within [0.9, 1.1] (1.01)`. */
  message: string;
}

// ── Schemas ─────────────────────────────────────

/** Zod schema of an expectation. */
export const ExpectationSchema = z
  .object({
    path: z.string().describe('Dot path into the subject; `*` expands arrays/objects, numeric segments index arrays.'),
    label: z.string().optional(),
    quantifier: z.enum(['all', 'any']).optional(),
    eq: z.unknown().optional(),
    ne: z.unknown().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    within: z.tuple([z.number(), z.number()]).optional(),
    oneOf: z.array(z.unknown()).optional(),
    contains: z.unknown().optional(),
    exists: z.boolean().optional(),
  })
  .describe('Assertion over a JSON subject: path plus one comparator (eq, ne, gt, gte, lt, lte, within, oneOf, contains, exists).');

/** Zod schema of an expectation result. */
export const ExpectationResultSchema = z.object({
  expectation: ExpectationSchema,
  pass: z.boolean(),
  actual: z.unknown(),
  message: z.string(),
});

// ── Path resolution ─────────────────────────────

/** Marker for "path does not resolve". */
const MISSING = Symbol('missing');

/** Resolves one path segment against a value; may fan out on `*`. */
function step(values: unknown[], segment: string): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    if (v === MISSING || v === null || typeof v !== 'object') {
      out.push(MISSING);
      continue;
    }
    if (segment === '*') {
      out.push(...(Array.isArray(v) ? v : Object.values(v)));
      continue;
    }
    if (Array.isArray(v) && segment === 'length') {
      out.push(v.length);
      continue;
    }
    const next = (v as Record<string, unknown>)[segment];
    out.push(next === undefined ? MISSING : next);
  }
  return out;
}

/** Resolves a dot path; returns the matches and whether the path fans out. */
export function resolvePath(subject: unknown, path: string): { values: unknown[]; multi: boolean } {
  const segments = path === '' ? [] : path.split('.');
  let values: unknown[] = [subject];
  for (const s of segments) values = step(values, s);
  return { values, multi: segments.includes('*') };
}

// ── Comparison ──────────────────────────────────

/** Structural equality of JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Checks one value against the comparators of an expectation. */
function check(e: Expectation, v: unknown): boolean {
  const exists = v !== MISSING;
  if (e.exists !== undefined && e.exists !== exists) return false;
  if (!exists) return e.exists === false;
  const n = typeof v === 'number' ? v : NaN;
  if ('eq' in e && e.eq !== undefined && !deepEqual(v, e.eq)) return false;
  if ('ne' in e && e.ne !== undefined && deepEqual(v, e.ne)) return false;
  if (e.gt !== undefined && !(n > e.gt)) return false;
  if (e.gte !== undefined && !(n >= e.gte)) return false;
  if (e.lt !== undefined && !(n < e.lt)) return false;
  if (e.lte !== undefined && !(n <= e.lte)) return false;
  if (e.within && !(n >= e.within[0] && n <= e.within[1])) return false;
  if (e.oneOf && !e.oneOf.some(o => deepEqual(v, o))) return false;
  if (e.contains !== undefined) {
    if (typeof v === 'string') return typeof e.contains === 'string' && v.includes(e.contains);
    if (Array.isArray(v)) return v.some(x => deepEqual(x, e.contains));
    return false;
  }
  return true;
}

/** Short text of the comparator part (`within [0.9, 1.1]`). */
function describeComparator(e: Expectation): string {
  const parts: string[] = [];
  const fmt = (x: unknown) => JSON.stringify(x);
  if (e.eq !== undefined) parts.push(`= ${fmt(e.eq)}`);
  if (e.ne !== undefined) parts.push(`≠ ${fmt(e.ne)}`);
  if (e.gt !== undefined) parts.push(`> ${e.gt}`);
  if (e.gte !== undefined) parts.push(`≥ ${e.gte}`);
  if (e.lt !== undefined) parts.push(`< ${e.lt}`);
  if (e.lte !== undefined) parts.push(`≤ ${e.lte}`);
  if (e.within) parts.push(`within [${e.within[0]}, ${e.within[1]}]`);
  if (e.oneOf) parts.push(`one of ${fmt(e.oneOf)}`);
  if (e.contains !== undefined) parts.push(`contains ${fmt(e.contains)}`);
  if (e.exists !== undefined) parts.push(e.exists ? 'exists' : 'is absent');
  return parts.join(' and ') || 'exists';
}

/** Compact rendering of the actual value for messages. */
function formatActual(v: unknown): string {
  if (v === MISSING) return 'missing';
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

// ── Evaluation ──────────────────────────────────

/** Evaluates one expectation against a subject. */
export function evaluateExpectation(subject: unknown, expectation: Expectation): ExpectationResult {
  const { values, multi } = resolvePath(subject, expectation.path);
  const results = values.map(v => check(expectation, v));
  const quantifier = expectation.quantifier ?? 'all';
  // `all` over zero matches fails: an empty fan-out usually means a wrong path.
  const pass = values.length > 0 && (quantifier === 'any' ? results.some(Boolean) : results.every(Boolean));
  const clean = values.map(v => (v === MISSING ? undefined : v));
  const actual = multi ? clean : clean[0];
  const shown = multi ? `[${values.map(formatActual).join(', ')}]` : formatActual(values[0]);
  const label = expectation.label ?? `${expectation.path}${multi ? ` (${quantifier})` : ''} ${describeComparator(expectation)}`;
  return { expectation, pass, actual, message: `${pass ? '✓' : '✗'} ${label} (${shown})` };
}

/** Evaluates several expectations against one subject. */
export function evaluateExpectations(subject: unknown, expectations: readonly Expectation[]): ExpectationResult[] {
  return expectations.map(e => evaluateExpectation(subject, e));
}
