// @vitest-environment node
/**
 * Zero-extension smoke test (ADR D17, plan P6.9): with no extension
 * registered, a project without kinds loads, an OFL-style fixture is added,
 * a built-in modifier is added and the real core engine (WASM, in Node)
 * renders changing DMX output through the plugin runtime.
 *
 * Needs the build outputs `node_modules/rs-engine-core` and `public/plugins`
 * (`bun run build:plugins`); skipped when they are absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resetRegistry, getExtensions } from '~/utils/extensions/registry';
import { Fixture } from '~/utils/engine/core/fixture';
import { deserializeProject, SCHEMA_VERSION, serializeFixture } from '~/utils/engine/serialize';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { buildChannelsBin, buildLayoutBin, buildModifiersBin, TYPE_CHAN_BIN, TYPE_LAYOUT_BIN, TYPE_MODIFIERS_BIN } from '~/utils/connectors/binary-encoder';
import { getManifest } from '~/utils/plugins/plugin-store';
import { WorkerPluginBridge } from '~/utils/plugins/worker-bridge';

const ROOT = join(__dirname, '..');
const CORE = join(ROOT, 'node_modules/rs-engine-core');
const ready = existsSync(join(CORE, 'rs_engine_core_bg.wasm')) && existsSync(join(ROOT, 'public/plugins'));

describe.skipIf(!ready)('zero extensions', () => {
  it('loads, adds a fixture and a built-in modifier, renders', async () => {
    resetRegistry();
    expect(getExtensions()).toEqual([]);

    // 1. A project without kinds opens.
    const fixture = Fixture.createRGBFixture('ofl-1');
    fixture.fixturePosition = { x: 0.5, y: 0.5 };
    const project = deserializeProject({
      schemaVersion: SCHEMA_VERSION, sceneNodes: [serializeFixture(fixture)], savedPresets: [], pinnedModifiers: [],
      globalBases: {}, modifiers: [], requires: [],
    });
    const fixtures = project.sceneNodes as Fixture[];
    expect(fixtures[0]!.channels.map(c => c.type)).toEqual(['RED', 'GREEN', 'BLUE', 'DIMMER']);
    // Full dimmer so the waveform is visible on the dimmer channel.
    fixtures[0]!.channels[3]!.chaserConfig.stepValues[0] = 255;

    // 2. A built-in modifier on the dimmer.
    const waveform = builtinHash(BUILTIN_ALIASES.waveform);
    const modifier = createModifier(waveform, { targetChannels: ['DIMMER'], speed: { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 } });

    // 3. The real engine with the plugin runtime (as in the worker).
    const bridge = new WorkerPluginBridge(() => {});
    bridge.install();
    const core = await import(join(CORE, 'rs_engine_core.js'));
    await core.default({ module_or_path: readFileSync(join(CORE, 'rs_engine_core_bg.wasm')) });
    const engine = new core.WasmEngine();
    engine.reset_clock(120);

    const { packet, plugins } = buildModifiersBin([modifier], fixtures, getManifest);
    bridge.load(waveform, readFileSync(join(ROOT, 'public/plugins', `${waveform.slice(7)}.wasm`)));
    bridge.setTable(plugins);
    expect(engine.dispatch(TYPE_LAYOUT_BIN, buildLayoutBin(fixtures).subarray(5))).toBe(1);
    expect(engine.dispatch(TYPE_CHAN_BIN, buildChannelsBin(fixtures).subarray(5))).toBeGreaterThan(0);
    expect(engine.dispatch(TYPE_MODIFIERS_BIN, packet.subarray(5))).toBe(1);

    const dimmerAt = (ms: number) => { engine.render(ms, 16); return engine.get_dmx_view()[3] as number; };
    const samples = [0, 250, 500, 750].map(dimmerAt);
    expect(new Set(samples).size).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeGreaterThan(200);
  });
});
