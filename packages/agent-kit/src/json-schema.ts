/**
 * JSON schema generation from Zod (ADR 0002 §5: schemas are generated once
 * and shared by every tool host).
 */
import { z } from 'zod';

/**
 * JSON schema of a Zod type. `io: 'input'` describes what callers send
 * (defaults optional). Never throws: unrepresentable types (functions,
 * transforms without output types) degrade to `{}` with a description.
 */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
  }
  catch (err) {
    console.warn('[agent-kit] JSON schema generation failed:', err);
    return { description: 'Schema not representable as JSON schema.' };
  }
}
