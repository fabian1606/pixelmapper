// @vitest-environment node
/**
 * Plan P3.9/P3.10: worker plugin bridge and watchdog.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildPackage, type ContentPluginManifest } from '@pixelmapper/plugin-toolchain';
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
    const ctx = new Float32Array(16);
    ctx[4] = 1;
    const samples = new Float32Array(32);
    samples[8] = 0.8;
    samples[16 + 8] = 0.4;
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
});
