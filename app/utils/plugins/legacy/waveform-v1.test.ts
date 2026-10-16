// @vitest-environment node
/**
 * Waveform 1.x → Wave 2 (plan M6.4, M6.5): the TS port matches the former
 * goldens, migrated instances render within 2 % RMS at base 100 %, and a
 * project saved before M6 opens on the current Wave without "missing plugin".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPackage, CTX, CTX_FIELDS, encodeParams, PluginInstance, SAMPLE, SAMPLE_FIELDS, type ContentPluginManifest } from '@pixelmapper/plugin-toolchain';
import { migrateWaveformV1, waveformV1Output, type WaveformV1Params } from './waveform-v1';
import { migrateSnapshot, type ProjectSnapshot } from '~/utils/engine/serialize';
import { BUILTIN_BY_ALIAS } from '../builtin-index';
import { getManifest } from '../plugin-store';

const DIR = join(__dirname, '../../../../plugins/waveform');
const OLD_HASH = 'sha256:ba72269469df1be8318d4e2d924dcc23c2a09f6a5efe60a2c00f2e4d1f5392df';

interface OldCase {
  params: WaveformV1Params;
  ctx: { strength: number };
  samples: { phase: number; base: number[] }[];
  expected: number[][];
  compare: 'raw' | 'mapped';
}
const legacy = JSON.parse(readFileSync(join(DIR, 'legacy-goldens.json'), 'utf8')) as { cases: OldCase[] };

describe('waveform 1.x port', () => {
  it('reproduces the former raw goldens', () => {
    for (const c of legacy.cases.filter(c => c.compare === 'raw')) {
      c.samples.forEach((s, i) => expect(waveformV1Output(c.params, s.phase, c.ctx.strength)).toBeCloseTo(c.expected[i]![0]!, 3));
    }
  });
});

describe('migration to Wave 2', () => {
  it('renders within 2 % RMS of the former output at base 100 % (away from hard edges)', async () => {
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as ContentPluginManifest;
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': readFileSync(join(DIR, 'modifier.ts'), 'utf8') });
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    let sq = 0;
    let n = 0;
    for (const c of legacy.cases) {
      const s = c.ctx.strength;
      inst.prepare(encodeParams(manifest.params, migrateWaveformV1(c.params, s)));
      for (const sample of c.samples) {
        const ctx = new Float32Array(CTX_FIELDS);
        ctx[CTX.arity] = 1;
        ctx[CTX.timePhase] = sample.phase;
        const buf = new Float32Array(SAMPLE_FIELDS);
        buf[SAMPLE.base0] = 1;
        const v = inst.render(ctx, buf, 1)[0]!;
        const now = Math.max(0, Math.min(1, 1 - s + s * v));
        const at = (ph: number) => Math.max(0, Math.min(1, 1 + (s * (waveformV1Output(c.params, ph, s) - 1)) / 2));
        const before = at(sample.phase);
        // Hard edges blur over one LUT step (1/64 cycle, plan §5 risk): skip samples next to a jump.
        const step = 1 / 63.5;
        if (Math.abs(at(sample.phase - step) - before) > 0.15 || Math.abs(at(sample.phase + step) - before) > 0.15) continue;
        sq += (now - before) ** 2;
        n++;
      }
    }
    expect(n).toBeGreaterThan(1500);
    expect(Math.sqrt(sq / n)).toBeLessThan(0.02);
  }, 120_000);

  it('a project saved before M6 opens on the current Wave', () => {
    const old = {
      id: 'm', plugin: OLD_HASH, signature: 'scalar', targetChannels: ['DIMMER'], blendMode: 'add', strength: 1,
      speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
      direction: 'LINEAR', originX: 0.2, originY: 0.5, angle: 0, fanning: 0.3, reverse: false,
      params: { shape: 'square', param: 0.5, start: 0, end: 1, offset: 0, useFloor: false, floor: 0 },
    };
    const snap = migrateSnapshot({ schemaVersion: 2, sceneNodes: [], globalBases: {}, savedPresets: [], pinnedModifiers: [], modifiers: [old] } as unknown as ProjectSnapshot);
    const m = snap.modifiers[0]!;
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/waveform']);
    expect(getManifest(m.plugin)?.name).toBe('Wave');
    expect(m.params).toHaveProperty('profile');
    expect(m.params.motion).toEqual({ shape: 'run', args: {} });
    expect(m.distribution.mode).toBe('linear');
  });
});
