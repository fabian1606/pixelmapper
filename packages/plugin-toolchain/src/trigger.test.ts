// @vitest-environment node
/**
 * ABI 1.3 `trigger` params: wire encoding, host edge timing (multi-click
 * window), manifest validation and the SDK readers end to end.
 */
import { describe, expect, it } from 'vitest';
import type { ParamSchema } from '@pixelmapper/extension-api';
import {
  buildPackage,
  CTX,
  CTX_FIELDS,
  encodeParams,
  PluginInstance,
  SAMPLE,
  SAMPLE_FIELDS,
  TRIGGER_NEVER_MS,
  triggerEdge,
  validate,
  validateManifest,
  type ContentPluginManifest,
} from './index';

const SCHEMA: ParamSchema = [
  { type: 'number', key: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  { type: 'trigger', key: 'hit', label: 'Hit', default: { pressed: false } },
];

/** Manifest of the end-to-end plugin. */
function manifest(params: ParamSchema = SCHEMA): ContentPluginManifest {
  return {
    schema: 1, kind: 'modifier', alias: '@test/trigger', name: 'Trigger', version: '1.0.0', apiVersion: '^1.3.0',
    description: 'Hold = dark, release = decaying flash.', signatures: ['scalar'], output: 'absolute', params,
  } as ContentPluginManifest;
}

describe('trigger encoding', () => {
  it('writes pressed, pressedAt, releasedAt, clicks after the preceding params', () => {
    expect(Array.from(encodeParams(SCHEMA, { hit: { pressed: true, pressedAt: 1200, releasedAt: 900, clicks: 2 } }))).toEqual([0.5, 1, 1200, 900, 2]);
  });

  it('encodes idle and invalid values as "never"', () => {
    expect(Array.from(encodeParams(SCHEMA, {}))).toEqual([0.5, 0, TRIGGER_NEVER_MS, TRIGGER_NEVER_MS, 0]);
    expect(Array.from(encodeParams(SCHEMA, { hit: 3 as never })).slice(1)).toEqual([0, TRIGGER_NEVER_MS, TRIGGER_NEVER_MS, 0]);
  });
});

describe('trigger host timing', () => {
  it('counts presses within the multi-click window as one burst', () => {
    let t = triggerEdge(undefined, true, 1000);
    expect(t).toEqual({ pressed: true, pressedAt: 1000, clicks: 1 });
    t = triggerEdge(t, false, 1100);
    expect(t).toMatchObject({ pressed: false, releasedAt: 1100, clicks: 1 });
    t = triggerEdge(t, true, 1300); // 200 ms after the release → double click
    expect(t).toMatchObject({ pressed: true, pressedAt: 1300, clicks: 2 });
    t = triggerEdge(triggerEdge(t, false, 1350), true, 1800); // 450 ms later → new burst
    expect(t.clicks).toBe(1);
  });

  it('honors a custom window and ignores repeated edges', () => {
    const released = triggerEdge(triggerEdge(undefined, true, 0), false, 100);
    expect(triggerEdge(released, true, 900, 1000).clicks).toBe(2);
    expect(triggerEdge(released, true, 900, 500).clicks).toBe(1);
    expect(triggerEdge(released, false, 500)).toBe(released);
  });
});

describe('trigger manifest validation', () => {
  it('accepts { pressed: false } and rejects other defaults', () => {
    expect(validateManifest(manifest()).errors).toEqual([]);
    const bad = validateManifest(manifest([{ type: 'trigger', key: 'hit', label: 'Hit', default: false as never }]));
    expect(bad.errors.join()).toMatch(/default must be \{ pressed: boolean \}/);
    const window = validateManifest(manifest([{ type: 'trigger', key: 'hit', label: 'Hit', default: { pressed: false }, multiClickMs: -1 }]));
    expect(window.errors.join()).toMatch(/multiClickMs/);
  });
});

describe('trigger SDK readers', () => {
  const SRC = `
import { Modifier, Frame, Sample, Out, register, triggerPressed, triggerMsSincePress, triggerMsSinceRelease, triggerClicks, envelope, TRIGGER_NEVER } from "@pixelmapper/plugin-sdk";
class Hit extends Modifier {
  render(ctx: Frame, s: Sample, out: Out): void {
    // Debug channel: base1 selects which reader to expose (0 = the actual look).
    const sel = <i32>s.base1;
    if (sel == 1) { out.set(0, triggerPressed(this.params, 1) ? 1.0 : 0.0); return; }
    if (sel == 2) { out.set(0, triggerMsSincePress(this.params, 1, ctx) / 10000.0); return; }
    if (sel == 3) { out.set(0, triggerMsSinceRelease(this.params, 1, ctx) >= TRIGGER_NEVER ? 1.0 : triggerMsSinceRelease(this.params, 1, ctx) / 10000.0); return; }
    if (sel == 4) { out.set(0, <f32>triggerClicks(this.params, 1) / 10.0); return; }
    out.set(0, triggerPressed(this.params, 1) ? 0.0 : envelope(triggerMsSinceRelease(this.params, 1, ctx), 0.0, 500.0) * this.params.get(0));
  }
}
register(new Hit());
`;

  it('derives ms since press/release from ctx.timeMs and passes the validation harness', async () => {
    const { pkg, diagnostics } = await buildPackage(manifest(), { 'modifier.ts': SRC });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const inst = PluginInstance.createSync(new WebAssembly.Module(new Uint8Array(pkg!.wasm)));
    inst.prepare(encodeParams(SCHEMA, { gain: 1, hit: { pressed: false, pressedAt: 1000, releasedAt: 1250, clicks: 2 } }));
    const ctx = new Float32Array(CTX_FIELDS);
    ctx[CTX.arity] = 1;
    ctx[CTX.timeMs] = 1500;
    const run = (sel: number) => {
      const samples = new Float32Array(SAMPLE_FIELDS);
      samples[SAMPLE.base1] = sel;
      return inst.render(ctx, samples, 1)[0]!;
    };
    expect(run(1)).toBe(0);
    expect(run(2)).toBeCloseTo(0.05, 5); // 500 ms
    expect(run(3)).toBeCloseTo(0.025, 5); // 250 ms
    expect(run(4)).toBeCloseTo(0.2, 5); // 2 clicks
    expect(run(0)).toBeCloseTo(0.5, 4); // envelope: 250 of 500 ms decay

    // Never released → TRIGGER_NEVER.
    inst.prepare(encodeParams(SCHEMA, { hit: { pressed: true, pressedAt: 1400, clicks: 1 } }));
    expect(run(3)).toBe(1);
    expect(run(1)).toBe(1);

    const report = await validate({ manifest: manifest(), wasm: pkg!.wasm }, { skipPerf: true, frames: 60 });
    expect(report.errors).toEqual([]);
  }, 60_000);
});
