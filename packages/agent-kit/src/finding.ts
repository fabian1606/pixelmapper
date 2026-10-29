/**
 * Findings (ADR 0002 §4.1, D5).
 *
 * Operations report problems and notes about their result as findings.
 * An `error` finding from `verify` rolls the whole transaction back.
 */
import { z } from 'zod';

/** Severity of a finding. `error` aborts a transaction. */
export type FindingLevel = 'error' | 'warning' | 'info';

/** One problem or note produced by an operation, the transaction runner or observation. */
export interface Finding {
  level: FindingLevel;
  /** Stable machine code, e.g. `plugin-not-found`, `invalid-input`. */
  code: string;
  /** Human/AI readable explanation, ideally with a hint how to fix it. */
  message: string;
  /** Entities the finding is about (`fixture:12`, `modifier:abc`, or plain ids). */
  entityIds?: string[];
  /** Index of the batch op that produced the finding (set by `apply`). */
  opIndex?: number;
}

/** Zod schema of a finding. */
export const FindingSchema = z.object({
  level: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  entityIds: z.array(z.string()).optional(),
  opIndex: z.number().int().optional(),
});

// ── Helpers ─────────────────────────────────────

/** Builds an error finding. */
export function errorFinding(code: string, message: string, entityIds?: string[]): Finding {
  return entityIds ? { level: 'error', code, message, entityIds } : { level: 'error', code, message };
}

/** Builds a warning finding. */
export function warningFinding(code: string, message: string, entityIds?: string[]): Finding {
  return entityIds ? { level: 'warning', code, message, entityIds } : { level: 'warning', code, message };
}

/** Builds an info finding. */
export function infoFinding(code: string, message: string, entityIds?: string[]): Finding {
  return entityIds ? { level: 'info', code, message, entityIds } : { level: 'info', code, message };
}

/** True when any finding is an error. */
export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some(f => f.level === 'error');
}
