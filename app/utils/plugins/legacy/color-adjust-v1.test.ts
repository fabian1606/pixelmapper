// @vitest-environment node
/**
 * Color Adjust 1.x → Color Shift 2 (plan M7.7): migrated instances render the
 * former goldens (cases without a saturation cycle) within 2 % RMS away from
 * hard edges; projects open on the current Color Shift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPackage, CTX, CTX_FIELDS, encodeParams, PluginInstance, SAMPLE, SAMPLE_FIELDS, type ContentPluginManifest } from '@pixelmapper/plugin-toolchain';
import { migrateColorAdjustV1, type ColorAdjustV1Params } from './color-adjust-v1';
import { evaluateShapeV1 } from './waveform-v1';
import { migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution';
import { BUILTIN_BY_ALIAS } from '../builtin-index';

const DIR = join(__dirname, '../../../../plugins/color-adjust');

interface OldCase {
  params: ColorAdjustV1Params;
  samples: { phase: number; base: number[] }[];
  expected: number[][];
}
const legacy = JSON.parse(readFileSync(join(DIR, 'legacy-goldens.json'), 'utf8')) as { cases: OldCase[] };

describe('color-adjust 1.x migration', () => {
  it('renders the former goldens within 2 % RMS (no saturation cycle, away from hard edges)', async () => {
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as ContentPluginManifest;
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': readFileSync(join(DIR, 'modifier.ts'), 'utf8') });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    let sq = 0;
    let n = 0;
    for (const c of legacy.cases.filter(c => !c.params.satRange)) {
      inst.prepare(encodeParams(manifest.params, migrateColorAdjustV1(c.params)));
      const cycle = (ph: number) => evaluateShapeV1(String(c.params.shape ?? 'sine'), ph - Math.floor(ph), Number(c.params.shapeParam ?? 0.5));
      c.samples.forEach((s, i) => {
        // Hard edges blur over one LUT step (plan §5 risk).
        if (Math.abs(cycle(s.phase + 1 / 63.5) - cycle(s.phase)) > 0.3 || Math.abs(cycle(s.phase - 1 / 63.5) - cycle(s.phase)) > 0.3) return;
        const ctx = new Float32Array(CTX_FIELDS);
        ctx[CTX.arity] = 3;
        ctx[CTX.timePhase] = s.phase;
        const buf = new Float32Array(SAMPLE_FIELDS);
        s.base.forEach((b, k) => { buf[SAMPLE.base0 + k] = b; });
        const out = inst.render(ctx, buf, 1);
        for (let k = 0; k < 3; k++) {
          sq += (out[k]! - c.expected[i]![k]!) ** 2;
          n++;
        }
      });
    }
    expect(n).toBeGreaterThan(100);
    expect(Math.sqrt(sq / n)).toBeLessThan(0.02);
  }, 120_000);

  it('redirects the old hash to Color Shift', () => {
    const [m] = migrateModifiersDeep([{
      id: 'c', plugin: 'sha256:090e2bc0a1a59f3aa152be198af698453918ca331ad99f1a3d7d7fb19446e793', signature: 'rgb', params: { hueShift: 30, hueRange: 20, shape: 'sine' },
      distribution: { mode: 'none' },
    }]);
    expect(m!.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/color-adjust']);
    expect(m!.params).toMatchObject({ mode: 'shift', hueShift: 30, hueRange: 20 });
  });
});
