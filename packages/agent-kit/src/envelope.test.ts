// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { exampleCall, normalizeApplyRequest, summarizeInputSchema } from './envelope';

describe('normalizeApplyRequest', () => {
  it('leaves canonical requests unchanged without findings', () => {
    const request = { label: 'x', ops: [{ op: 'fixtures.move', input: { moves: [] } }] };
    expect(normalizeApplyRequest(request)).toEqual({ request, findings: [] });
  });

  it('folds input keys placed next to `op` into `input`', () => {
    const { request, findings } = normalizeApplyRequest({ label: 'x', ops: [{ op: 'fixtures.move', moves: [1] }] });
    expect(request).toEqual({ label: 'x', ops: [{ op: 'fixtures.move', input: { moves: [1] } }] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'info', code: 'input-folded', opIndex: 0 });
    expect(findings[0]!.message).toContain('"input": { "moves": … }');
  });

  it('reads `params` as `input`', () => {
    const { request } = normalizeApplyRequest({ label: 'x', ops: [{ op: 'a.b', params: { k: 1 } }] });
    expect(request).toEqual({ label: 'x', ops: [{ op: 'a.b', input: { k: 1 } }] });
  });

  it('rejects extra keys next to `input`', () => {
    const { findings } = normalizeApplyRequest({ label: 'x', ops: [{ op: 'a.b', input: {}, moves: [] }] });
    expect(findings[0]).toMatchObject({ level: 'error', code: 'invalid-envelope' });
    expect(findings[0]!.message).toContain('put `moves` inside `input`');
  });

  it('wraps a single top-level op into `ops`', () => {
    const { request } = normalizeApplyRequest({ label: 'x', op: 'a.b', input: { k: 1 } });
    expect(request).toEqual({ label: 'x', ops: [{ op: 'a.b', input: { k: 1 } }] });
  });
});

describe('rendering', () => {
  const schema = {
    type: 'object',
    properties: { moves: { type: 'array', items: { type: 'object', properties: { fixtureId: { type: 'string' }, x: { type: 'number' } }, required: ['fixtureId'] } } },
    required: ['moves'],
  };

  it('summarizes an input schema with optional markers', () => {
    expect(summarizeInputSchema(schema)).toBe('{ moves: { fixtureId: string, x?: number }[] }');
  });

  it('builds the apply call from the first example', () => {
    const call = exampleCall({ id: 'fixtures.move', kind: 'mutation', summary: '', inputSchema: schema, examples: [{ input: { moves: [] }, note: 'Move one.' }] });
    expect(call).toEqual({ tool: 'apply', input: { label: 'Move one', ops: [{ op: 'fixtures.move', input: { moves: [] } }] } });
  });

  it('uses inspect for queries and placeholders without examples', () => {
    const call = exampleCall({ id: 'fixtures.get', kind: 'query', summary: '', inputSchema: schema, examples: [] });
    expect(call).toEqual({ tool: 'inspect', input: { selector: { op: 'fixtures.get', input: { moves: '<object[]>' } } } });
  });
});
