/**
 * Observation request / report (ADR 0002 §6.1, §6.4; plan M2 "observe-lite").
 *
 * Only the contract lives here; the implementation is host-side
 * (`app/utils/observability`). Modes:
 * - `live`: capture the real output of the running app over a window;
 * - `preview`: render a plugin / modifier instance headlessly on the
 *   project's real fixture positions (deterministic, can look ahead);
 * - `sim`: reserved for the full simulation engine (ADR §6.2).
 */
import { z } from 'zod';
import { ExpectationResultSchema, ExpectationSchema, type Expectation, type ExpectationResult } from './expectation';
import { FindingSchema, type Finding } from './finding';

// ── Selector / time ─────────────────────────────

/**
 * What to observe: `'all'`, `'selection'`, fixture/group ids, or a filter
 * (same fields as the `fixtures.find` operation).
 */
export type ObserveTargets =
  | 'all'
  | 'selection'
  | Array<string | number>
  | { ids?: Array<string | number>; groupIds?: Array<string | number>; kind?: string; signature?: string; name?: string };

/** Duration / time reference: `'2s'`, `'500ms'`, `'8 beats'`, or seconds as a number. */
export type TimeRef = string | number;

/** Zod schema of the observe targets. */
export const ObserveTargetsSchema = z.union([
  z.literal('all'),
  z.literal('selection'),
  z.array(z.union([z.string(), z.number()])),
  z.object({
    ids: z.array(z.union([z.string(), z.number()])).optional(),
    groupIds: z.array(z.union([z.string(), z.number()])).optional(),
    kind: z.string().optional(),
    signature: z.string().optional(),
    name: z.string().optional(),
  }),
]);

/** Zod schema of a time reference. */
export const TimeRefSchema = z
  .union([z.string().regex(/^\s*\d+(\.\d+)?\s*(ms|s|beats?)\s*$/), z.number().nonnegative()])
  .describe('Duration: "2s", "500ms", "8 beats", or seconds as a number.');

// ── Request ─────────────────────────────────────

/** Request of the `observe` tool. */
export interface ObserveRequest {
  targets: ObserveTargets;
  /** Default `'preview'` when `modifierId`/`plugin` is set, else `'live'`. */
  mode?: 'live' | 'preview' | 'sim';
  /** Window; default 2 s starting now (live) or at t = 0 (preview). */
  window?: { from?: TimeRef; duration: TimeRef };
  /** Sample rate; default 30. */
  fps?: number;
  /** Aggregation level of the report; default `'group'`. */
  detail?: 'group' | 'fixture' | 'raw';
  /** Preview: an existing modifier instance to render. */
  modifierId?: string;
  /** Preview: a plugin (alias or hash) with params, rendered as a fresh instance. */
  plugin?: { ref: string; params?: Record<string, unknown>; signature?: string };
  /**
   * Points (normalized world x/y) for the `radial` feature: "does it radiate
   * from here?". Preview adds the instance's canvas `point` params itself.
   */
  points?: Array<{ x: number; y: number }>;
  expect?: Expectation[];
}

/** Zod schema of the observe request. */
export const ObserveRequestSchema = z.object({
  targets: ObserveTargetsSchema,
  mode: z.enum(['live', 'preview', 'sim']).optional(),
  window: z.object({ from: TimeRefSchema.optional(), duration: TimeRefSchema }).optional(),
  fps: z.number().positive().max(120).optional(),
  detail: z.enum(['group', 'fixture', 'raw']).optional(),
  modifierId: z.string().optional(),
  plugin: z.object({
    ref: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    signature: z.string().optional(),
  }).optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).max(16).optional(),
  expect: z.array(ExpectationSchema).optional(),
});

// ── Report ──────────────────────────────────────

/** Report of the `observe` tool: compact text for the model plus JSON features. */
export interface ObserveReport {
  /** Compact text in the ADR §6.4 style. */
  text: string;
  /** Feature JSON (`range`, `color`, `temporal`, `spatial`, … per group / fixture); expectations run on it. */
  json: Record<string, unknown>;
  /** Results of `request.expect`. */
  expectations: ExpectationResult[];
  findings?: Finding[];
}

/** Zod schema of the observe report. */
export const ObserveReportSchema = z.object({
  text: z.string(),
  json: z.record(z.string(), z.unknown()),
  expectations: z.array(ExpectationResultSchema),
  findings: z.array(FindingSchema).optional(),
});
