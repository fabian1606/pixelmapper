// @vitest-environment node
/**
 * The validation rig fills `timePhase`, `rank`, `rankCount`, `spatial` and
 * `spread` like the engine does for the distribution modes a manifest offers,
 * so distribution-driven plugins are not misreported as constant.
 */
import { describe, expect, it } from 'vitest';
import { buildPackage, validate, type ContentPluginManifest } from './index';

/** Minimal valid manifest with an optional distribution block. */
function manifest(overrides: Partial<ContentPluginManifest> = {}): ContentPluginManifest {
  return {
    schema: 1,
    kind: 'modifier',
    alias: '@test/runner',
    name: 'Runner',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    description: 'A narrow pulse running through the fixture order.',
    signatures: ['scalar'],
    output: 'absolute',
    params: [{ key: 'width', type: 'number', min: 0.01, max: 0.2, default: 0.05, label: 'Width' }],
    ...overrides,
  };
}

/** Order-spread runner: a narrow pulse over (rank + head fraction) / rankCount vs. the time phase. */
const RUNNER = `
import { Modifier, Frame, Sample, Out, Params, register, pulse, fract } from "@pixelmapper/plugin-sdk";
class M extends Modifier {
  width: f32 = 0.05;
  prepare(p: Params): void { this.width = p.get(0); }
  render(ctx: Frame, s: Sample, out: Out): void {
    // Without ranks there is nothing to run through.
    if (ctx.rankCount < 1 || s.rank < 0) { out.setScalar(0.0); return; }
    const headFrac = <f32>s.headIndex / <f32>max(1, s.headCount);
    const pos = (<f32>s.rank + headFrac) / <f32>ctx.rankCount;
    out.setScalar(pulse(fract(ctx.timePhase) - pos, 0.0, this.width, 0.5));
  }
}
register(new M());
`;

/** Spatial plugin: a band moving along \`spatial\` over time. */
const SPATIAL = `
import { Modifier, Frame, Sample, Out, register, pulse, fract } from "@pixelmapper/plugin-sdk";
class M extends Modifier {
  render(ctx: Frame, s: Sample, out: Out): void {
    out.setScalar(pulse(fract(ctx.timePhase - s.spatial), 0.5, 0.1, 0.5));
  }
}
register(new M());
`;

/** Genuinely constant plugin. */
const CONSTANT = `
import { Modifier, Frame, Sample, Out, register } from "@pixelmapper/plugin-sdk";
class M extends Modifier {
  render(ctx: Frame, s: Sample, out: Out): void { out.setScalar(0.25); }
}
register(new M());
`;

/** Builds and validates a plugin source. */
async function check(source: string, m: ContentPluginManifest) {
  const { pkg, diagnostics } = await buildPackage(m, { 'modifier.ts': source });
  expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  return validate({ manifest: m, wasm: pkg!.wasm }, { frames: 125, skipPerf: true });
}

describe('validation rig distribution', () => {
  it('animates an order-spread runner (modes: order)', async () => {
    const r = await check(RUNNER, manifest({ distribution: { modes: ['order'] } }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter(w => /constant/.test(w))).toEqual([]);
    expect(r.metrics.outputMax).toBeGreaterThan(0.5);
  }, 60_000);

  it('animates the runner within each fixture (scopes: within)', async () => {
    const r = await check(RUNNER, manifest({ distribution: { scopes: ['within'] } }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter(w => /constant/.test(w))).toEqual([]);
  }, 60_000);

  it('animates a spatial band when no distribution is declared (all modes)', async () => {
    const r = await check(SPATIAL, manifest({ params: [] }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter(w => /constant/.test(w))).toEqual([]);
  }, 60_000);

  it('still flags a genuinely constant plugin', async () => {
    const r = await check(CONSTANT, manifest({ params: [], distribution: { modes: ['order', 'linear'] } }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => /constant/.test(w))).toBe(true);
  }, 60_000);
});
