// @vitest-environment node
/**
 * End-to-end goldens of `observe` (plan M2): preview through the real
 * `rs-engine-core` (headless, in Node) with built-in and toolchain-compiled
 * plugins on a seeded scene, plus a live capture over a fake hub.
 *
 * Needs `rs-engine/core/pkg` (`bun run build:wasm`) and `public/plugins`
 * (`bun run build:wasm && bun run build:plugins`); skipped when absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enginePkgDir } from '~~/scripts/engine-packages';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiveFrame, LiveTarget } from '@pixelmapper/extension-api';
import { buildPackage, type ContentPluginManifest } from '@pixelmapper/plugin-toolchain';
import { useEngineStore } from '~/stores/engine-store';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import type { ModifierInstance } from '~/utils/engine/types';
import { Beam } from '~/utils/engine/core/beam';
import { createDistribution } from '~/utils/engine/distribution/create';
import type { FrameCallback, LiveListener } from '~/utils/extensions/live-hub';
import { getManifest, isBuiltin, loadWasm, registerPackage } from '~/utils/plugins/plugin-store';
import { resetOperationState, seedScene, stubOperationGlobals } from '~/utils/operations/test-utils';
import type { HeadlessCore } from './preview-core';
import { observe, setPreviewCoreLoader } from './index';

const ROOT = join(__dirname, '../../..');
const CORE = enginePkgDir('rs-engine-core', ROOT);
const ready = existsSync(join(CORE, 'rs_engine_core_bg.wasm')) && existsSync(join(ROOT, 'public/plugins'));

/** Built-ins from `public/plugins`, other plugins from the store. */
const plugins = {
  getManifest,
  loadWasm: async (hash: string) => (isBuiltin(hash)
    ? new Uint8Array(readFileSync(join(ROOT, 'public/plugins', `${hash.slice(7)}.wasm`)))
    : loadWasm(hash)),
};

/** Seeds `n` DRGB fixtures in a row (or the given positions) with the dimmer at full. */
function scene(n: number, pos?: (i: number) => { x: number; y: number }) {
  const fixtures = seedScene(Array.from({ length: n }, (_, i) => ({ id: `f${i}`, ...(pos ? pos(i) : { x: (i + 0.5) / n, y: 0.5 }) })));
  for (const f of fixtures) {
    const dimmer = f.channels.find(c => c.type === 'DIMMER')!;
    dimmer.chaserConfig.stepValues[0] = 255;
  }
  return fixtures;
}

/** Adds a modifier to the store and returns it. */
function addModifier(alias: string, init: Partial<ModifierInstance>): ModifierInstance {
  const m = createModifier(builtinHash(alias), { targetChannels: ['DIMMER'], ...init });
  useEngineStore().modifiers = [m];
  return m;
}

/** 1 s per cycle. */
const ONE_HZ = { mode: 'time' as const, timeMs: 1000, beatValue: 1, beatOffset: 0 };

describe.skipIf(!ready)('observe (preview, real engine)', () => {
  beforeAll(() => {
    stubOperationGlobals();
    setPreviewCoreLoader(async () => {
      const core = await import(join(CORE, 'rs_engine_core.js'));
      await core.default({ module_or_path: readFileSync(join(CORE, 'rs_engine_core_bg.wasm')) });
      return core as unknown as HeadlessCore;
    });
  });
  afterAll(() => setPreviewCoreLoader(null));
  beforeEach(() => resetOperationState());

  it('waveform at 1 Hz, all the same → periodic 1.00 Hz, uniform', async () => {
    scene(8);
    const m = addModifier(BUILTIN_ALIASES.waveform, { speed: ONE_HZ, distribution: { mode: 'none' } as never });
    const report = await observe({
      targets: 'all',
      modifierId: m.id,
      expect: [{ path: 'group.temporal.kind', eq: 'periodic' }, { path: 'group.temporal.hz', within: [0.98, 1.02] }],
    }, { plugins });
    expect(report.findings?.filter(f => f.level === 'error')).toEqual([]);
    expect(report.expectations.every(e => e.pass), report.text).toBe(true);
    expect((report.json.group as { spatial: { kind: string } }).spatial.kind, report.text).toBe('uniform');
    expect(report.text).toMatch(/^observe all · 0\.0–2\.0s · 30 fps · preview/);
    expect(report.text).toContain('EXPECT');
  });

  it('waveform spread in order over 8 fixtures → chase, step 1/8', async () => {
    scene(8);
    const m = addModifier(BUILTIN_ALIASES.waveform, { speed: ONE_HZ });
    expect(m.distribution.mode).toBe('order');
    const report = await observe({ targets: 'all', modifierId: m.id }, { plugins });
    const spatial = (report.json.group as { spatial: { kind: string; step: number; direction: number[] } }).spatial;
    expect(spatial.kind, report.text).toBe('chase');
    expect(spatial.step).toBeGreaterThan(0.125 - 0.01);
    expect(spatial.step).toBeLessThan(0.125 + 0.01);
  });

  it('noise → aperiodic', async () => {
    scene(8);
    const m = addModifier(BUILTIN_ALIASES.noise, { speed: { mode: 'time', timeMs: 150, beatValue: 1, beatOffset: 0 }, params: { rangeMin: 0, rangeMax: 1 } as never });
    const report = await observe({ targets: 'all', modifierId: m.id, window: { duration: '4s' } }, { plugins });
    expect((report.json.group as { temporal: { kind: string } }).temporal.kind, report.text).toBe('aperiodic');
  });

  it('strength 0 → constant with a finding', async () => {
    scene(4);
    const m = addModifier(BUILTIN_ALIASES.waveform, { speed: ONE_HZ, strength: 0 });
    const report = await observe({ targets: 'all', modifierId: m.id }, { plugins });
    expect((report.json.group as { temporal: { kind: string } }).temporal.kind).toBe('constant');
    expect(report.findings?.some(f => f.code === 'observe-constant-output')).toBe(true);
  });

  it('stuck output warns, but only info for snapshot windows or passing expectations', async () => {
    scene(4);
    const m = addModifier(BUILTIN_ALIASES.waveform, { speed: ONE_HZ, strength: 0 });
    const level = async (req: Partial<Parameters<typeof observe>[0]>) => {
      const report = await observe({ targets: 'all', modifierId: m.id, ...req }, { plugins });
      return report.findings?.find(f => f.code === 'observe-stuck')?.level;
    };
    expect(await level({})).toBe('warning');
    expect(await level({ window: { duration: '100ms' } })).toBe('info');
    expect(await level({ expect: [{ path: 'group.range.min', gte: 0.99 }] })).toBe('info');
    // A failing expectation keeps the warning.
    expect(await level({ expect: [{ path: 'group.range.min', lt: 0.5 }] })).toBe('warning');
  });

  it('zero targets → finding, no crash', async () => {
    scene(4);
    const m = addModifier(BUILTIN_ALIASES.waveform, { speed: ONE_HZ });
    const report = await observe({ targets: { name: 'nothing-matches' }, modifierId: m.id }, { plugins });
    expect(report.findings?.some(f => f.code === 'observe-zero-targets')).toBe(true);
  });

  it('12-pixel tube, waveform spread within → per-pixel max, fixture max = brightest pixel, onset order', async () => {
    // One DRGB tube with 12 pixels along x (the waveform scales the full dimmer base).
    const [f] = scene(1);
    const template = f!.channels;
    f!.beams = Array.from({ length: 12 }, (_, h) => new Beam(`px-${h}`, (h - 5.5) * 2, 0));
    f!.channels = f!.beams.flatMap((b, h) => template.map(c => ({
      ...c,
      addressOffset: h * 4 + c.addressOffset,
      beamId: b.id,
      chaserConfig: { ...c.chaserConfig, stepValues: [255] },
    })));
    const m = addModifier(BUILTIN_ALIASES.waveform, {
      speed: ONE_HZ,
      distribution: createDistribution({ mode: 'order', scope: 'within' }),
    });
    const report = await observe({
      targets: 'all',
      modifierId: m.id,
      window: { duration: '2s' },
      expect: [
        { path: 'fixtures.*.heads.length', eq: 12 },
        { path: 'fixtures.*.heads.*.range.max', gt: 0.9, label: 'every pixel lights up' },
        { path: 'fixtures.*.range.max', gt: 0.9 },
      ],
    }, { plugins });
    expect(report.expectations.map(e => e.message).filter((_, i) => !report.expectations[i]!.pass), report.text).toEqual([]);
    const json = report.json as { group: { order?: { direction: string; axis: string } }; fixtures: Record<string, { heads: Array<{ onset?: number }> }> };
    const heads = Object.values(json.fixtures)[0]!.heads;
    expect(heads).toHaveLength(12);
    // Waveform within: pixels run one after another along the rank.
    expect(json.group.order?.axis, report.text).toBe('spread');
    expect(['forward', 'reverse']).toContain(json.group.order?.direction);
  });

  it('unknown modifier → error finding', async () => {
    scene(2);
    const report = await observe({ targets: 'all', modifierId: 'nope' }, { plugins });
    expect(report.findings?.[0]?.code).toBe('modifier-not-found');
  });

  it('a compiled radial plugin (distance to 4 points) → radial r > 0.9', async () => {
    // 8 × 8 grid, dimmer at 0 (a fresh instance blends `add`: a full base would saturate at 1).
    const grid = scene(64, i => ({ x: 0.1 + (i % 8) * 0.8 / 7, y: 0.1 + Math.floor(i / 8) * 0.8 / 7 }));
    for (const f of grid) f.channels.find(c => c.type === 'DIMMER')!.chaserConfig.stepValues[0] = 0;
    const point = (key: string, x: number, y: number) => ({ key, type: 'point', default: { x, y }, label: key, ui: { canvas: 'point' } });
    const manifest = {
      schema: 1, kind: 'modifier', alias: '@test/radial-rings', name: 'Radial rings', version: '1.0.0', apiVersion: '^1.3.0',
      description: 'Rings expanding from four points.', signatures: ['scalar'], output: 'absolute',
      params: [point('a', 0.25, 0.25), point('b', 0.75, 0.25), point('c', 0.25, 0.75), point('d', 0.75, 0.75)],
    } as unknown as ContentPluginManifest;
    const source = `
import { Modifier, Frame, Sample, Out, Params, register, minDistToPoints } from "@pixelmapper/plugin-sdk";
class Rings extends Modifier {
  pts: StaticArray<f32> = new StaticArray<f32>(8);
  prepare(p: Params): void { for (let i = 0; i < 8; i++) this.pts[i] = p.get(i); }
  render(ctx: Frame, s: Sample, out: Out): void {
    const d = minDistToPoints(s.x, s.y, 1.0, this.pts, 4);
    out.setScalar(0.5 + 0.5 * Mathf.cos(6.2831853 * (ctx.timePhase - d * 3.0)));
  }
}
register(new Rings());
`;
    const { pkg, diagnostics } = await buildPackage(manifest, { 'modifier.ts': source });
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    registerPackage(pkg!);

    const started = performance.now();
    const report = await observe({
      targets: 'all',
      plugin: { ref: pkg!.hash },
      expect: [{ path: 'group.radial.r', gt: 0.9 }],
    }, { plugins });
    const ms = performance.now() - started;
    expect(report.expectations[0]?.pass, report.text).toBe(true);
    expect((report.json.group as { radial: { from: unknown[] } }).radial.from).toHaveLength(4);
    // Performance budget: 64 fixtures × 2 s × 30 fps (plugin compile included).
    expect(ms).toBeLessThan(300);
  }, 60_000);
});

describe('observe (live, fake hub)', () => {
  beforeAll(() => stubOperationGlobals());
  beforeEach(() => resetOperationState());

  it('captures signature tuples at 1 Hz and falls back to DMX', async () => {
    const fixtures = scene(4);
    const listeners = new Map<string, LiveListener>();
    let frameCb: FrameCallback | null = null;
    const hub = {
      subscribe: (t: LiveTarget, l: LiveListener) => {
        if (t.kind === 'signature') listeners.set(String(t.fixtureId), l);
        return () => {};
      },
      addFrameCallback: (cb: FrameCallback) => { frameCb = cb; return () => { frameCb = null; }; },
    };
    let clock = 0;
    // The "engine": 60 frames per second for the window; fixture f3 only on the wire.
    const wait = async (ms: number) => {
      for (let t = 0; t <= ms; t += 1000 / 60) {
        clock = t;
        const v = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / 1000));
        for (const f of fixtures.slice(0, 3)) listeners.get(String(f.id))?.(new Float32Array([v, v, v]));
        const dmx = new Uint8Array(512);
        dmx.fill(Math.round(v * 255));
        frameCb?.({ timeMs: t, beat: { beatTime: 0, bpm: 120, phase: 0 }, dmx } as LiveFrame);
      }
    };
    const report = await observe({
      targets: 'all',
      mode: 'live',
      expect: [{ path: 'group.temporal.hz', within: [0.97, 1.03] }, { path: 'fixtures.f3.range.max', gt: 0.9 }],
    }, { hub, wait, now: () => clock });
    expect(report.expectations.map(e => e.message), report.text).toEqual(report.expectations.filter(e => e.pass).map(e => e.message));
    expect(report.findings?.some(f => f.code === 'observe-note')).toBe(true);
  });
});

describe('observe (live, failed engine)', () => {
  beforeAll(() => stubOperationGlobals());
  beforeEach(() => resetOperationState());

  it('reports engine-unavailable instead of measuring an all-zero output', async () => {
    scene(2);
    const report = await observe(
      { targets: 'all', mode: 'live' },
      { engineFailure: () => 'Engine build does not match the app: rs-engine-core has no ABI version.' },
    );
    expect(report.findings?.map(f => f.code)).toContain('engine-unavailable');
    expect(report.text).toContain('engine-unavailable');
  });
});
