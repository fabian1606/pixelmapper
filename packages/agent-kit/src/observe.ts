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
 * What to observe: `'all'`, `'selection'`, fixture/group ids, or a filter.
 * The filter speaks the `fixtures.find` vocabulary (`ids`, `kind`, `name`)
 * and the `modifiers.add` targets vocabulary (`fixtureIds` = `ids`,
 * `groupIds`, `signature`, `channelTypes` = fixtures with any of these
 * channel types), so a modifier's targets can be passed as they are.
 * Unknown keys are rejected (they used to fall back to all fixtures).
 */
export type ObserveTargets =
  | 'all'
  | 'selection'
  | Array<string | number>
  | {
    ids?: Array<string | number>;
    fixtureIds?: Array<string | number> | null;
    groupIds?: Array<string | number>;
    kind?: string;
    signature?: string;
    channelTypes?: string[];
    name?: string;
  };

/** Duration / time reference: `'2s'`, `'500ms'`, `'8 beats'`, or seconds as a number. */
export type TimeRef = string | number;

/** Keys of the observe target filter (error messages, docs). */
export const OBSERVE_TARGET_KEYS = ['ids', 'fixtureIds', 'groupIds', 'kind', 'signature', 'channelTypes', 'name'] as const;

/** Clear message for a target filter with unknown keys (instead of zod's "Invalid input"). */
function targetsError(issue: { input?: unknown; errors?: Array<Array<{ code: string; keys?: string[] }>> }): string | undefined {
  const keys = (issue.errors ?? []).flat().filter(e => e.code === 'unrecognized_keys').flatMap(e => e.keys ?? []);
  if (keys.length > 0) {
    return `unknown target key${keys.length === 1 ? '' : 's'} ${keys.map(k => `"${k}"`).join(', ')}; use "all", "selection", an id list, or a filter with ${OBSERVE_TARGET_KEYS.join(', ')}`;
  }
  return undefined;
}

/** Zod schema of the observe targets (strict filter: unknown keys are errors). */
export const ObserveTargetsSchema = z.union([
  z.literal('all'),
  z.literal('selection'),
  z.array(z.union([z.string(), z.number()])),
  z.strictObject({
    ids: z.array(z.union([z.string(), z.number()])).optional(),
    fixtureIds: z.array(z.union([z.string(), z.number()])).nullable().optional()
      .describe('Alias of ids (modifiers.add vocabulary); null = all fixtures.'),
    groupIds: z.array(z.union([z.string(), z.number()])).optional(),
    kind: z.string().optional(),
    signature: z.string().optional(),
    channelTypes: z.array(z.string()).optional()
      .describe('Only fixtures with at least one channel of these types (e.g. ["DIMMER"]).'),
    name: z.string().optional(),
  }),
], { error: iss => targetsError(iss as never) });

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
  /**
   * Mirror lines for the `mirror` feature (normalized world coordinates):
   * `x` = the vertical line (left ↔ right), `y` = the horizontal line
   * (front ↔ back). Default: the room center.
   */
  mirror?: { x?: number; y?: number };
  /**
   * Live only: trigger actions fired at offsets inside the capture window
   * (`at` relative to the window start), like `modifiers.trigger`: no undo
   * step, no project change. Catches the start of a release wave or flash
   * that a separate trigger call + observe would miss.
   */
  triggers?: ObserveTrigger[];
  expect?: Expectation[];
}

/** One timed trigger action of a live observation. */
export interface ObserveTrigger {
  /** Offset from the window start (`'0.5s'`, `'500ms'`, `'1 beat'`, seconds). */
  at: TimeRef;
  modifierId: string;
  paramKey: string;
  action: 'press' | 'release' | 'click';
  /** Only for `click`: clicks in the burst (1–8). */
  clicks?: number;
}

/** Most timed triggers per observation. */
export const MAX_OBSERVE_TRIGGERS = 8;

/** Zod schema of a timed trigger (strict: unknown keys are an error). */
export const ObserveTriggerSchema = z.object({
  at: TimeRefSchema.describe('Offset from the window start: "0.5s", "500ms", "1 beat" or seconds. Must lie inside the window.'),
  modifierId: z.string().min(1).describe('Modifier with the trigger param.'),
  paramKey: z.string().min(1).describe('Trigger param key (e.g. "hit").'),
  action: z.enum(['press', 'release', 'click']).describe('"press" holds, "release" lets go, "click" = press + release.'),
  clicks: z.number().int().min(1).max(8).optional().describe('Only for "click": clicks in the burst (default 1).'),
}).strict();

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
  mirror: z.object({ x: z.number().optional(), y: z.number().optional() }).optional()
    .describe('Mirror lines for group.mirror (world x of the vertical line, world y of the horizontal line); default the room center.'),
  triggers: z.array(ObserveTriggerSchema).max(MAX_OBSERVE_TRIGGERS).optional()
    .describe('Live only: trigger actions fired at `at` inside the capture window (like modifiers.trigger: no undo step). E.g. [{ at: "0.5s", modifierId: "ai-flash", paramKey: "hit", action: "release" }].'),
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
