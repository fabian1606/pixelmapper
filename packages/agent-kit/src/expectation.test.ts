// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateExpectation, evaluateExpectations } from './expectation';
import { toJsonSchema } from './json-schema';
import { ApplyRequestSchema } from './apply';
import { isActor } from './actor';

/** Feature-like subject used by the tests. */
const subject = {
  temporal: { kind: 'periodic', hz: 1.02 },
  fixtures: [{ id: 'a', x: 0.1 }, { id: 'b', x: 0.9 }],
  tags: ['wave', 'radial'],
};

describe('expectation evaluator', () => {
  it('checks eq / within on dot paths', () => {
    const [kind, hz] = evaluateExpectations(subject, [
      { path: 'temporal.kind', eq: 'periodic' },
      { path: 'temporal.hz', within: [0.9, 1.1] },
    ]);
    expect(kind!.pass).toBe(true);
    expect(hz!.pass).toBe(true);
    expect(hz!.message).toContain('✓');
  });

  it('fails with a readable message', () => {
    const r = evaluateExpectation(subject, { path: 'temporal.hz', gt: 2 });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/^✗ temporal\.hz > 2 \(1\.02\)/);
  });

  it('fans out over * with all / any quantifiers', () => {
    expect(evaluateExpectation(subject, { path: 'fixtures.*.x', gte: 0.5 }).pass).toBe(false);
    expect(evaluateExpectation(subject, { path: 'fixtures.*.x', gte: 0.5, quantifier: 'any' }).pass).toBe(true);
    expect(evaluateExpectation(subject, { path: 'fixtures.*.x', gte: 0.5, quantifier: 'any' }).actual).toEqual([0.1, 0.9]);
  });

  it('supports exists, contains, oneOf, length and array indices', () => {
    expect(evaluateExpectation(subject, { path: 'temporal.missing', exists: false }).pass).toBe(true);
    expect(evaluateExpectation(subject, { path: 'temporal.missing', eq: 1 }).pass).toBe(false);
    expect(evaluateExpectation(subject, { path: 'tags', contains: 'wave' }).pass).toBe(true);
    expect(evaluateExpectation(subject, { path: 'fixtures.1.id', oneOf: ['b', 'c'] }).pass).toBe(true);
    expect(evaluateExpectation(subject, { path: 'fixtures.length', eq: 2 }).pass).toBe(true);
  });
});

describe('schemas', () => {
  it('generates JSON schemas from zod', () => {
    const schema = toJsonSchema(ApplyRequestSchema);
    expect(schema.type).toBe('object');
    expect((schema.required as string[])).toContain('ops');
  });

  it('validates actors', () => {
    expect(isActor('user')).toBe(true);
    expect(isActor('agent:mcp:claude')).toBe(true);
    expect(isActor('robot')).toBe(false);
  });
});
