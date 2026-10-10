// @vitest-environment node
/**
 * Curve param validation (plan M1.5).
 */
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest';

/** A minimal manifest with one curve param. */
function withCurve(curve: Record<string, unknown>) {
  return {
    schema: 1, kind: 'modifier', alias: '@test/curve', name: 'Curve', version: '1.0.0', apiVersion: '^1.0.0',
    description: 'Test manifest with a curve.', signatures: ['scalar'], output: 'scale',
    params: [{ key: 'profile', type: 'curve', label: 'Profile', ...curve }],
  };
}

describe('curve params', () => {
  it('accepts programmatic, free and legacy defaults', () => {
    expect(validateManifest(withCurve({ domain: 'signed', shapes: ['dot', 'wave'], default: { shape: 'dot', args: { width: 0.2 } } })).errors).toEqual([]);
    expect(validateManifest(withCurve({ default: { points: [{ x: 0, y: 0, kind: 'step' }, { x: 1, y: 1 }] } })).errors).toEqual([]);
    expect(validateManifest(withCurve({ default: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).errors).toEqual([]);
  });

  it('rejects bad enums, args and domain mismatches', () => {
    const r = validateManifest(withCurve({ domain: 'half', axis: 'x', range: 'tri', default: { shape: 'run', args: {} } }));
    expect(r.errors.join('\n')).toMatch(/domain must be one of/);
    expect(r.errors.join('\n')).toMatch(/axis must be one of/);
    expect(r.errors.join('\n')).toMatch(/range must be one of/);
    const m = validateManifest(withCurve({ domain: 'signed', shapes: ['run'], default: { shape: 'dot', args: { size: 1 } } }));
    expect(m.errors.join('\n')).toMatch(/shape "run" has domain "cycle", param has "signed"/);
    expect(m.errors.join('\n')).toMatch(/shape "dot" has no arg "size"/);
    expect(validateManifest(withCurve({ default: { points: [{ x: 0, y: 2 }] } })).errors.join('\n')).toMatch(/points must be in 0–1/);
    expect(validateManifest(withCurve({ default: { shape: 'dot', args: { width: 'x' } } })).errors.join('\n')).toMatch(/args must be numbers/);
  });

  it('warns about shapes only extensions know', () => {
    const r = validateManifest(withCurve({ shapes: ['my-ext/zigzag'], default: { shape: 'my-ext/zigzag', args: {} } }));
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/"my-ext\/zigzag" is not built in/);
  });
});
