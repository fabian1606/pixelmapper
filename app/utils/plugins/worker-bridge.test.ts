// @vitest-environment node
/**
 * Plan P3.9/P3.10: worker plugin bridge and watchdog.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildPackage, CTX, CTX_FIELDS, SAMPLE, SAMPLE_FIELDS, type ContentPluginManifest } from '@pixelmapper/plugin-toolchain';
import { WorkerPluginBridge, type BridgeEvent } from './worker-bridge';
import { Watchdog } from './watchdog';

const manifest: ContentPluginManifest = {
  schema: 1, kind: 'modifier', alias: '@test/half', name: 'Half', version: '1.0.0', apiVersion: '^1.0.0',
  description: 'Outputs base × gain, or loops forever when gain < 0.',
  signatures: ['scalar'], output: 'bipolar',
  params: [{ key: 'gain', type: 'number', min: -1, max: 1, default: 0.5, label: 'Gain' }],
};
const source = `
import { Modifier, Frame, Sample, Out, Params, register } from "@pixelmapper/plugin-sdk";
class Half extends Modifier {
  gain: f32 = 0.5;
  prepare(p: Params): void { this.gain = p.get(0); }
  render(ctx: Frame, s: Sample, out: Out): void {
    let i: i32 = 0;
    while (this.gain < 0.0) { i++; }
    out.set(0, s.base0 * this.gain + <f32>i);
  }
}
register(new Half());
`;

describe('worker plugin bridge', () => {
  it('prepares, renders into the out view, and reports traps', async () => {
    const { pkg } = await buildPackage(manifest, { 'modifier.ts': source });
    const events: BridgeEvent[] = [];
    const bridge = new WorkerPluginBridge(e => events.push(e));

    // Unknown plugin index / module not loaded yet.
    bridge.setTable([pkg!.hash]);
    expect(bridge.prepare(1, 0, new Float32Array([0.5]))).toBe(false);

    bridge.load(pkg!.hash, pkg!.wasm);
    expect(bridge.prepare(1, 0, new Float32Array([0.5]))).toBe(true);
    const ctx = new Float32Array(CTX_FIELDS);
    ctx[CTX.arity] = 1;
    const samples = new Float32Array(2 * SAMPLE_FIELDS);
    samples[SAMPLE.base0] = 0.8;
    samples[SAMPLE_FIELDS + SAMPLE.base0] = 0.4;
    const engineMemory = new Float32Array(8);
    const out = engineMemory.subarray(2, 4); // a view, as wasm-bindgen passes it
    expect(bridge.render(1, ctx, samples, 2, out)).toBe(true);
    expect(engineMemory[2]).toBeCloseTo(0.4);
    expect(engineMemory[3]).toBeCloseTo(0.2);

    // Infinite loop → budget trap → instance dropped and reported.
    expect(bridge.prepare(1, 0, new Float32Array([-1]))).toBe(true);
    expect(bridge.render(1, ctx, samples, 2, out)).toBe(false);
    expect(events[0]).toMatchObject({ type: 'plugin-error', instance: 1, reason: 'budget' });
    expect(bridge.render(1, ctx, samples, 2, out)).toBe(false);

    // Suspended plugins do not prepare.
    bridge.setSuspended([pkg!.hash]);
    expect(bridge.prepare(2, 0, new Float32Array([0.5]))).toBe(false);
  }, 60_000);
});

describe('watchdog', () => {
  it('fires once after 1 s without heartbeat', () => {
    let now = 0;
    const onStall = vi.fn();
    const wd = new Watchdog({ onStall, now: () => now });
    wd.beat();
    now = 900;
    wd.check();
    expect(onStall).not.toHaveBeenCalled();
    now = 1001;
    wd.check();
    expect(onStall).toHaveBeenCalledTimes(1);
    now = 1500;
    wd.check();
    expect(onStall).toHaveBeenCalledTimes(1);
    now = 2600;
    wd.check();
    expect(onStall).toHaveBeenCalledTimes(2);
  });

  it('passes the ABI v1.1 frame and sample fields (plan M3.7)', async () => {
    const v11 = { ...manifest, alias: '@test/v11', apiVersion: '^1.1.0', params: [] };
    const src = `
import { Modifier, Frame, Sample, Out, register } from "@pixelmapper/plugin-sdk";
class Fields extends Modifier {
  render(ctx: Frame, s: Sample, out: Out): void {
    out.set(0, s.spatial + <f32>s.rank * 10.0 + <f32>s.distGroup * 100.0
      + ctx.timePhase * 1000.0 + <f32>ctx.rankCount * 10000.0 + <f32>ctx.distGroupCount * 100000.0);
  }
}
register(new Fields());
`;
    const { pkg, diagnostics } = await buildPackage(v11, { 'modifier.ts': src });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const bridge = new WorkerPluginBridge(() => {});
    bridge.setTable([pkg!.hash]);
    bridge.load(pkg!.hash, pkg!.wasm);
    expect(bridge.prepare(3, 0, new Float32Array(0))).toBe(true);
    const ctx = new Float32Array(CTX_FIELDS);
    ctx[CTX.arity] = 1;
    ctx[CTX.timePhase] = 2;
    ctx[CTX.rankCount] = 4;
    ctx[CTX.distGroupCount] = 3;
    const samples = new Float32Array(SAMPLE_FIELDS);
    samples[SAMPLE.spatial] = 0.5;
    samples[SAMPLE.rank] = 2;
    samples[SAMPLE.distGroup] = 1;
    const out = new Float32Array(1);
    expect(bridge.render(3, ctx, samples, 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(0.5 + 20 + 100 + 2000 + 40000 + 300000, 0);
  }, 60_000);

  it('passes the ABI v1.3 room fields (z, u, v, worldAspect, worldDepth, metersPerUnit)', async () => {
    const v13 = { ...manifest, alias: '@test/v13', apiVersion: '^1.3.0', params: [] };
    const src = `
import { Modifier, Frame, Sample, Out, register } from "@pixelmapper/plugin-sdk";
class Room extends Modifier {
  render(ctx: Frame, s: Sample, out: Out): void {
    out.set(0, s.z + s.u * 10.0 + s.v * 100.0 + ctx.worldAspect * 1000.0 + ctx.worldDepth * 10000.0 + ctx.metersPerUnit * 100000.0);
  }
}
register(new Room());
`;
    const { pkg, diagnostics } = await buildPackage(v13, { 'modifier.ts': src });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const bridge = new WorkerPluginBridge(() => {});
    bridge.setTable([pkg!.hash]);
    bridge.load(pkg!.hash, pkg!.wasm);
    expect(bridge.prepare(4, 0, new Float32Array(0))).toBe(true);
    const ctx = new Float32Array(CTX_FIELDS);
    ctx[CTX.arity] = 1;
    ctx[CTX.worldAspect] = 2;
    ctx[CTX.worldDepth] = 0.5;
    ctx[CTX.metersPerUnit] = 3;
    const samples = new Float32Array(SAMPLE_FIELDS);
    samples[SAMPLE.z] = 0.25;
    samples[SAMPLE.u] = 0.5;
    samples[SAMPLE.v] = 0.75;
    const out = new Float32Array(1);
    expect(bridge.render(4, ctx, samples, 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(0.25 + 5 + 75 + 2000 + 5000 + 300000, 0);
  }, 60_000);
});
