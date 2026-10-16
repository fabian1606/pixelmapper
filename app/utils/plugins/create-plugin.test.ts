// @vitest-environment node
/**
 * Create-from-code seam (plan P4.3): the template builds and validates; JSON,
 * compile and validation problems come back as staged diagnostics.
 */
import { describe, expect, it } from 'vitest';
import { buildFromCode, TEMPLATE_MANIFEST, TEMPLATE_SOURCE } from './create-plugin';
import { getManifest } from './plugin-store';

describe('buildFromCode', () => {
  it('builds, validates and registers the template', async () => {
    const res = await buildFromCode({ manifest: JSON.stringify(TEMPLATE_MANIFEST), source: { 'modifier.ts': TEMPLATE_SOURCE } });
    expect(res.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(res.pkg?.hash).toMatch(/^sha256:/);
    expect(getManifest(res.pkg!.hash)?.name).toBe('Pulse Train');
    expect(res.metrics!.outputMax).toBeLessThanOrEqual(1);
  }, 60_000);

  it('reports invalid manifest JSON', async () => {
    const res = await buildFromCode({ manifest: '{ nope', source: { 'modifier.ts': TEMPLATE_SOURCE } });
    expect(res.pkg).toBeNull();
    expect(res.diagnostics[0]!.stage).toBe('manifest');
  });

  it('reports compile errors', async () => {
    const res = await buildFromCode({ manifest: TEMPLATE_MANIFEST, source: { 'modifier.ts': 'this is not code' } });
    expect(res.pkg).toBeNull();
    expect(res.diagnostics.some(d => d.stage === 'compile' && d.severity === 'error')).toBe(true);
  }, 60_000);

  it('reports validation errors (out-of-range absolute output)', async () => {
    const manifest = { ...TEMPLATE_MANIFEST, output: 'absolute' as const };
    const source = TEMPLATE_SOURCE.replace('out.setScalar(clamp(v, 0.0, 1.0));', 'out.setScalar(v - 0.5);');
    const res = await buildFromCode({ manifest, source: { 'modifier.ts': source } });
    expect(res.pkg).toBeNull();
    expect(res.diagnostics.some(d => d.stage === 'validate' && d.severity === 'error')).toBe(true);
  }, 60_000);
});
