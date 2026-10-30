// @vitest-environment node
/**
 * Automated acceptance of the MCP-first agent layer (plan M6, ADR 0002 B12).
 *
 * Drives the **agent tools** (`createTools()` + `createAppAgentHost()`) the
 * way Claude does over MCP, on a seeded room (LED tubes along the walls,
 * patched as a clockwise loop, plus PARs in the corners), with `observe`
 * rendering through the real `rs-engine-core` WASM:
 *
 * (a) corner-wave: `plugins.get` → one `apply` batch (`modifiers.add` with
 *     corner points from the digest + `live.addPage` / `live.addWidget` with
 *     caller-chosen ids) = one undo step; observe radial; a point "drag"
 *     (`modifiers.update`) moves the radial origin;
 * (b) mirror-runner: `group.mirror.x.r` ≈ 1 on the loop-patched room;
 * (c) a trigger plugin built with `plugins.build` (hold = blackout,
 *     release = envelope): observe preview with frozen trigger states.
 *     Preview cannot press a button in real time, so each state is one
 *     observation (see docs/ai/skills/effect-authoring/verification.md).
 *
 * Needs `bun run build:wasm && bun run build:plugins`; skipped when absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enginePkgDir } from '~~/scripts/engine-packages';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTools, findTool, type AgentHost, type ObserveRequest, type ToolOutput } from '@pixelmapper/agent-kit';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { Beam } from '~/utils/engine/core/beam';
import type { Channel } from '~/utils/engine/core/channel';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup } from '~/utils/engine/core/group';
import { WORLD_WIDTH } from '~/utils/engine/constants';
import { observe, setPreviewCoreLoader } from '~/utils/observability';
import type { HeadlessCore } from '~/utils/observability/preview-core';
import { createOperationRegistry, registerCoreOperations } from '~/utils/operations';
import { readApi } from '~/utils/operations/read-api';
import { resetOperationState, stateFingerprint, stubOperationGlobals } from '~/utils/operations/test-utils';
import { getManifest, isBuiltin, loadWasm } from '~/utils/plugins/plugin-store';
import { createAppAgentHost } from './host';

const ROOT = join(__dirname, '../../..');
const CORE = enginePkgDir('rs-engine-core', ROOT);
const ready = existsSync(join(CORE, 'rs_engine_core_bg.wasm')) && existsSync(join(ROOT, 'public/plugins'));

/** The real fetch: the AssemblyScript compiler (plugins.build) loads its wasm through it. */
const realFetch = globalThis.fetch;

const tools = createTools();
const ACTOR = 'agent:mcp:acceptance' as const;
let host: AgentHost;

/** Built-ins from `public/plugins`, built plugins from the store. */
const plugins = {
  getManifest,
  loadWasm: async (hash: string) => (isBuiltin(hash)
    ? new Uint8Array(readFileSync(join(ROOT, 'public/plugins', `${hash.slice(7)}.wasm`)))
    : loadWasm(hash)),
};

// ── Tool helpers ────────────────────────────────

/** Runs a tool by name as the MCP actor. */
function run(name: string, input: unknown): Promise<ToolOutput> {
  return findTool(tools, name)!.run(host, input, { actor: ACTOR });
}

/** Text of the first content item. */
function textOf(out: ToolOutput): string {
  const first = out.content[0];
  return first?.type === 'text' ? first.text : '';
}

/** JSON content item value. */
function jsonOf<T = unknown>(out: ToolOutput): T {
  const item = out.content.find(c => c.type === 'json');
  return (item && item.type === 'json' ? item.json : undefined) as T;
}

/** Observe report as the tool returns it (text + json content). */
interface ObserveJson {
  json: Record<string, any>;
  expectations: Array<{ pass: boolean; message?: string }>;
}

/** Runs the observe tool and asserts every expectation passed. */
async function observeOk(request: ObserveRequest): Promise<ObserveJson> {
  const out = await run('observe', request);
  expect(out.isError, textOf(out)).toBeUndefined();
  const report = jsonOf<ObserveJson>(out);
  expect(report.expectations.filter(e => !e.pass), textOf(out)).toEqual([]);
  return report;
}

// ── Scene: a room ───────────────────────────────

/** Chaser config of one channel at a constant value. */
function chaser(value: number): Channel['chaserConfig'] {
  return {
    stepValues: [value],
    stepsCount: 1,
    activeEditStep: 0,
    isPlaying: false,
    stepDuration: { mode: 'beat', timeMs: 1000, beatValue: 1, beatOffset: 0 },
    fadeDuration: { mode: 'beat', timeMs: 0, beatValue: 0, beatOffset: 0 },
  } as Channel['chaserConfig'];
}

/** DRGB channels of one head (dimmer at full, colors white). */
function drgb(offset: number, beamId?: string): Channel[] {
  const ch = (type: string, i: number, role: string, color: string): Channel => ({
    type, addressOffset: offset + i, role, colorValue: color, defaultValue: 0, chaserConfig: chaser(255), ...(beamId ? { beamId } : {}),
  } as unknown as Channel);
  return [ch('DIMMER', 0, 'DIMMER', '#FFFFFF'), ch('RED', 1, 'COLOR', '#FF0000'), ch('GREEN', 2, 'COLOR', '#00FF00'), ch('BLUE', 3, 'COLOR', '#0000FF')];
}

/** Pixel count per tube. */
const HEADS = 12;

/**
 * An LED tube centered at (x, y) of `length` world units; `rotation` in
 * degrees sets the patch direction (0 → pixel 1 on the left, 90 → on top,
 * 180 → on the right, 270 → at the bottom).
 */
function tube(id: string, x: number, y: number, length: number, rotation: number, address: number): Fixture {
  const f = new Fixture(id, [], address);
  f.name = id;
  f.fixturePosition = { x, y };
  f.rotation = rotation;
  // localX is scaled by 2 × FIXTURE_RADIUS (36 px) in beamWorldPx.
  const pitch = (length * WORLD_WIDTH) / 36 / (HEADS - 1);
  f.beams = Array.from({ length: HEADS }, (_, h) => new Beam(`px-${h}`, (h - (HEADS - 1) / 2) * pitch, 0));
  f.channels = f.beams.flatMap((b, h) => drgb(h * 4, b.id));
  return f;
}

/** A single-head DRGB PAR. */
function par(id: string, x: number, y: number, address: number): Fixture {
  const f = new Fixture(id, drgb(0), address);
  f.name = id;
  f.fixturePosition = { x, y };
  return f;
}

/**
 * Room 0.1–0.9 × 0.2–0.8: four tubes along the walls patched as a
 * clockwise loop (front left→right, right wall top→bottom, back
 * right→left, left wall bottom→top) and four PARs in the corners.
 */
function seedRoom(): void {
  const tubes = [
    tube('tube-front', 0.5, 0.2, 0.6, 0, 1),
    tube('tube-right', 0.9, 0.5, 0.4, 90, 49),
    tube('tube-back', 0.5, 0.8, 0.6, 180, 97),
    tube('tube-left', 0.1, 0.5, 0.4, 270, 145),
  ];
  const pars = [par('par-tl', 0.1, 0.2, 201), par('par-tr', 0.9, 0.2, 205), par('par-br', 0.9, 0.8, 209), par('par-bl', 0.1, 0.8, 213)];
  const gTubes = new FixtureGroup('g-tubes', 'Tubes');
  for (const t of tubes) gTubes.addChild(t);
  const gPars = new FixtureGroup('g-pars', 'PARs');
  for (const p of pars) gPars.addChild(p);
  useEngineStore().sceneNodes = [gTubes, gPars];
}

// ── Tests ───────────────────────────────────────

describe.skipIf(!ready)('effect acceptance through the agent tools (real engine)', () => {
  beforeAll(() => {
    stubOperationGlobals();
    // Built-in sources (`/plugins/<hash>.json`) from `public/`, everything else (compiler wasm) real.
    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => (typeof url === 'string' && url.startsWith('/plugins/')
      ? Promise.resolve(new Response(readFileSync(join(ROOT, 'public', url), 'utf8')))
      : realFetch(url, init)));
    setPreviewCoreLoader(async () => {
      const core = await import(join(CORE, 'rs_engine_core.js'));
      await core.default({ module_or_path: readFileSync(join(CORE, 'rs_engine_core_bg.wasm')) });
      return core as unknown as HeadlessCore;
    });
  });
  afterAll(() => setPreviewCoreLoader(null));
  beforeEach(() => {
    resetOperationState();
    seedRoom();
    host = createAppAgentHost({
      registry: registerCoreOperations(createOperationRegistry()),
      observe: async () => (req, opts) => observe(req, { plugins, ...opts }),
    });
  });

  it('(a) corner wave with draggable corner points and a live page in one undo step', async () => {
    // 1. Read the project and the reference plugin like an agent would.
    const digest = jsonOf<{ fixtures: Array<{ x: number; y: number }> }>(await run('inspect', { selector: 'project' }));
    expect(digest.fixtures).toHaveLength(8);
    const xs = digest.fixtures.map(f => f.x);
    const ys = digest.fixtures.map(f => f.y);
    const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const plugin = await run('inspect', { selector: { op: 'plugins.get', input: { plugin: '@pixelmapper/corner-wave' } } });
    expect(plugin.isError, textOf(plugin)).toBeUndefined();
    // The agent sees the canvas hints and the reference source.
    expect(textOf(plugin)).toMatch(/"canvas": ?"point"/);
    expect(textOf(plugin)).toContain('minDistToPoints');

    // 2. One batch: effect + control page, ids chosen by the caller.
    const before = stateFingerprint();
    const out = await run('apply', {
      label: 'Corner wave',
      ops: [
        {
          op: 'modifiers.add',
          input: {
            id: 'ai-corner-wave',
            plugin: '@pixelmapper/corner-wave',
            recipe: 'corners',
            targets: { groupIds: ['g-tubes', 'g-pars'] },
            params: {
              a: { x: box.minX, y: box.minY },
              b: { x: box.maxX, y: box.minY },
              c: { x: box.maxX, y: box.maxY },
              d: { x: box.minX, y: box.maxY },
            },
          },
        },
        { op: 'live.addPage', input: { id: 'ai-corner-wave-page', name: 'Corner Wave' } },
        { op: 'live.addWidget', input: { pageId: 'ai-corner-wave-page', type: 'slider', label: 'Reach', mapping: { type: 'effect-param', modifierId: 'ai-corner-wave', paramKey: 'reach' } } },
        { op: 'live.addWidget', input: { pageId: 'ai-corner-wave-page', type: 'xy', label: 'Point A', mapping: { type: 'effect-param', modifierId: 'ai-corner-wave', paramKey: 'a' } } },
      ],
      expect: [
        { path: 'state.modifiers.*.id', quantifier: 'any', eq: 'ai-corner-wave' },
        { path: 'state.livePages.*.id', quantifier: 'any', eq: 'ai-corner-wave-page' },
      ],
    });
    expect(out.isError, textOf(out)).toBeUndefined();
    expect(readApi.modifiers()).toHaveLength(1);
    expect(useHistory().lastDescription.value).toBe('AI: Corner wave');

    // 3. Radiates from the four corner points.
    const first = await observeOk({
      mode: 'preview',
      modifierId: 'ai-corner-wave',
      targets: { groupIds: ['g-tubes', 'g-pars'] },
      window: { duration: '8 beats' },
      expect: [
        { path: 'group.temporal.kind', eq: 'periodic' },
        { path: 'group.radial.r', gt: 0.8 },
        { path: 'group.radial.from.length', eq: 4 },
      ],
    });
    expect(first.json.group.radial.from[0]).toEqual({ key: 'a', x: box.minX, y: box.minY });

    // 4. "Drag" point A to the room center (the canvas commits modifiers.update the same way).
    const drag = await run('apply', { label: 'Move point A', ops: [{ op: 'modifiers.update', input: { modifierId: 'ai-corner-wave', params: { a: { x: 0.5, y: 0.5 } } } }] });
    expect(drag.isError, textOf(drag)).toBeUndefined();
    const second = await observeOk({
      mode: 'preview',
      modifierId: 'ai-corner-wave',
      targets: { groupIds: ['g-tubes', 'g-pars'] },
      window: { duration: '8 beats' },
      expect: [{ path: 'group.radial.from.0.x', eq: 0.5 }, { path: 'group.radial.r', gt: 0.7 }],
    });
    expect(second.json.group.radial.from[0].y).toBe(0.5);

    // 5. Two undo steps: the drag, then the whole batch (effect + page + widgets).
    useHistory().undo();
    expect(readApi.modifier('ai-corner-wave')?.params.a).toEqual({ x: box.minX, y: box.minY });
    useHistory().undo();
    expect(stateFingerprint()).toBe(before);
  }, 60_000);

  it('(b) mirror runner on loop-patched tubes is a left/right mirror image', async () => {
    const out = await run('apply', {
      label: 'Mirror runner',
      ops: [{ op: 'modifiers.add', input: { id: 'ai-runner', plugin: '@pixelmapper/mirror-runner', recipe: 'runner', targets: { groupIds: ['g-tubes'] } } }],
    });
    expect(out.isError, textOf(out)).toBeUndefined();
    const report = await observeOk({
      mode: 'preview',
      modifierId: 'ai-runner',
      targets: { groupIds: ['g-tubes'] },
      window: { duration: '8 beats' },
      expect: [
        { path: 'group.temporal.kind', eq: 'periodic' },
        { path: 'group.mirror.x.r', gte: 0.95 },
        { path: 'group.mirror.x.at', within: [0.49, 0.51] },
      ],
    });
    // Left/right mirroring is not a front/back mirror on this patch.
    expect(report.json.group.mirror.y.r).toBeLessThan(0.9);

    // Mirror "off": the loop now runs around the room, no left/right mirror.
    await run('apply', { label: 'Mirror off', ops: [{ op: 'modifiers.update', input: { modifierId: 'ai-runner', params: { mirror: 'off' } } }] });
    const off = await observeOk({ mode: 'preview', modifierId: 'ai-runner', targets: { groupIds: ['g-tubes'] }, window: { duration: '8 beats' } });
    expect(off.json.group.mirror.x.r).toBeLessThan(0.9);
  }, 60_000);

  it('(c) a built trigger effect: hold = blackout, release = envelope (frozen states)', async () => {
    const manifest = {
      schema: 1, kind: 'modifier', alias: '@acceptance/blackout-flash', name: 'Blackout Flash', version: '1.0.0', apiVersion: '^1.3.0',
      description: 'Hold the button for a blackout; releasing it fires a flash that decays back to the idle level.',
      signatures: ['scalar'], output: 'absolute',
      distribution: { modes: ['none'], scopes: ['across'], default: { scope: 'across', mode: 'none' } },
      params: [
        { key: 'hit', type: 'trigger', label: 'Hit', default: { pressed: false }, description: 'Hold = blackout, release = flash.' },
        { key: 'decay', type: 'number', min: 50, max: 3000, step: 10, default: 500, label: 'Decay', unit: 'ms', description: 'Flash fade-out time.' },
      ],
    };
    const source = `
import { Modifier, Frame, Sample, Out, Params, register, envelope, triggerPressed, triggerMsSinceRelease } from "@pixelmapper/plugin-sdk";
class BlackoutFlash extends Modifier {
  decay: f32 = 500.0;
  prepare(p: Params): void { this.decay = p.get(4); }
  render(ctx: Frame, s: Sample, out: Out): void {
    if (triggerPressed(this.params, 0)) { out.setScalar(0.0); return; }
    out.setScalar(0.2 + 0.8 * envelope(triggerMsSinceRelease(this.params, 0, ctx), 0.0, this.decay));
  }
}
register(new BlackoutFlash());
`;
    const built = await run('apply', { label: 'Build blackout flash', ops: [{ op: 'plugins.build', input: { manifest, source } }] });
    expect(built.isError, textOf(built)).toBeUndefined();
    const result = jsonOf<{ results: Array<{ value?: { ok: boolean; hash: string } }> }>(built).results[0]?.value;
    expect(result?.ok, textOf(built)).toBe(true);
    const hash = result!.hash;

    // Effect + a live button mapped to the trigger, one batch.
    const added = await run('apply', {
      label: 'Blackout flash',
      ops: [
        { op: 'modifiers.add', input: { id: 'ai-flash', plugin: hash, targets: { groupIds: ['g-tubes', 'g-pars'] } } },
        { op: 'live.addPage', input: { id: 'ai-flash-page', name: 'Blackout' } },
        { op: 'live.addWidget', input: { pageId: 'ai-flash-page', type: 'button', label: 'Hold = blackout', mapping: { type: 'effect-param', modifierId: 'ai-flash', paramKey: 'hit' } } },
      ],
    });
    expect(added.isError, textOf(added)).toBeUndefined();
    const targets = { groupIds: ['g-tubes', 'g-pars'] };
    const withHit = (hit: Record<string, unknown>) => ({ ref: hash, params: { hit } });

    // Idle: never pressed → idle level.
    await observeOk({ mode: 'preview', modifierId: 'ai-flash', targets, expect: [{ path: 'group.range.max', within: [0.18, 0.22] }] });
    // Held (pressed at preview t = 0) → blackout.
    await observeOk({ mode: 'preview', modifierId: 'ai-flash', plugin: withHit({ pressed: true, pressedAt: 0, clicks: 1 }), targets, expect: [{ path: 'group.range.max', lte: 0.02 }] });
    // A frozen trigger state is an intended hold: stuck-0 is info, not a warning (even without expect).
    const held = jsonOf<{ findings?: Array<{ code: string; level: string }> }>(await run('observe', { mode: 'preview', modifierId: 'ai-flash', plugin: withHit({ pressed: true, pressedAt: 0, clicks: 1 }), targets }));
    expect(held.findings?.filter(f => f.code === 'observe-stuck').map(f => f.level)).toEqual(['info']);
    // Released at t = 0 → flash at full, decaying to the idle level within the window.
    const flash = await observeOk({
      mode: 'preview', modifierId: 'ai-flash', plugin: withHit({ pressed: false, pressedAt: 0, releasedAt: 0, clicks: 1 }), targets, window: { duration: '1s' },
      expect: [{ path: 'group.range.max', gte: 0.95 }, { path: 'group.range.min', within: [0.18, 0.22] }, { path: 'group.temporal.kind', ne: 'constant' }],
    });
    expect(flash.json.group.spatial.kind).toBe('uniform');
    // Later window: the flash is over.
    await observeOk({
      mode: 'preview', modifierId: 'ai-flash', plugin: withHit({ pressed: false, pressedAt: 0, releasedAt: 0, clicks: 1 }), targets, window: { from: '1s', duration: '1s' },
      expect: [{ path: 'group.range.max', lte: 0.22 }],
    });
  }, 120_000);
});
