/**
 * `preview` observations (ADR 0002 §6, plan M2).
 *
 * Renders ONE modifier instance (an existing one or a fresh instance of a
 * plugin ref) over the project's real layout in a private headless engine
 * (`preview-core.ts`) and reads back the per-head signature values after
 * every frame. Base values come from the project's channel chasers, so
 * `scale`/`bipolar` outputs show what the instance does on this rig. Other
 * modifiers of the stack are not rendered (the report isolates the
 * instance; `live` shows the full stack).
 *
 * Deterministic: frames are rendered at `from + i / fps` from a fresh engine
 * and fresh plugin state, so `from` can look ahead.
 */
import { paramCanvasHint } from '@pixelmapper/extension-api';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance, Signature } from '~/utils/engine/types';
import {
  buildChannelsBin,
  buildLayoutBin,
  buildModifiersBin,
  CHANNEL_TYPE_ID,
  TYPE_CHAN_BIN,
  TYPE_LAYOUT_BIN,
  TYPE_MODIFIERS_BIN,
} from '~/utils/connectors/binary-encoder';
import { resolveDistribution } from '~/utils/engine/distribution/resolve';
import { sampleDistribution, spreadKind } from '~/utils/engine/distribution/sample';
import { WorkerPluginBridge, type BridgeEvent } from '~/utils/plugins/worker-bridge';
import { loadPreviewCore, withPluginBridge } from './preview-core';
import { headSamples, type HeadSample } from './targets';
import type { Trace, TracePoint, TraceSample, TraceSource } from './types';

// ── Inputs ──────────────────────────────────────

/** Plugin lookups of a preview (plugin store by default; injectable). */
export interface PreviewPlugins {
  getManifest(hash: string): ContentPluginManifest | undefined;
  loadWasm(hash: string): Promise<Uint8Array | null>;
}

/** One preview render. */
export interface PreviewInput {
  /** All fixtures in layout order (the engine layout; room box). */
  layout: readonly Fixture[];
  /** Observed fixtures (subset of `layout`). */
  targets: readonly Fixture[];
  /** The instance to render. */
  modifier: ModifierInstance;
  bpm: number;
  fromS: number;
  durationS: number;
  fps: number;
  /** Extra points for radial analysis (request points). */
  points?: TracePoint[];
  /** Group ids of a fixture (innermost first). */
  groupIds(f: Fixture): Array<string | number>;
}

/** Wire ids of signatures (rs-engine `Signature::from_id`). */
const SIGNATURE_ID: Record<Signature, number> = { scalar: 0, rgb: 1, panTilt: 2 };
/** Values per signature. */
const ARITY: Record<Signature, number> = { scalar: 1, rgb: 3, panTilt: 2 };
/** Spread kinds by ABI `spread` value. */
const SPREADS: TraceSource['spread'][] = ['none', 'spatial', 'order', 'within'];

// ── Helpers ─────────────────────────────────────

/** Points of the instance's `point` params with a canvas hint (radial analysis). */
export function canvasPoints(manifest: ContentPluginManifest, params: Record<string, unknown>): TracePoint[] {
  const out: TracePoint[] = [];
  for (const def of manifest.params) {
    if (def.type !== 'point' || paramCanvasHint(def.ui)?.canvas !== 'point') continue;
    const v = (params[def.key] ?? def.default) as { x?: number; y?: number } | undefined;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) out.push({ key: def.key, x: v.x!, y: v.y! });
  }
  return out;
}

/** Fixtures the instance renders to (its `targetFixtureIds`, else all). */
function instanceTargets(m: ModifierInstance, fixtures: readonly Fixture[]): Fixture[] {
  if (!m.targetFixtureIds) return [...fixtures];
  const ids = new Set(m.targetFixtureIds.map(String));
  return fixtures.filter(f => ids.has(String(f.id)));
}

/** Adds the distribution coordinates of every sample (ADR B6: features follow the spread). */
function withSpread(samples: HeadSample[], m: ModifierInstance, layout: readonly Fixture[]): void {
  const resolved = resolveDistribution(m, layout);
  for (const s of samples) {
    const d = sampleDistribution(m.distribution, resolved.rankCount, {
      x: s.x,
      y: s.y,
      fixtureRank: resolved.ranks[String(s.fixtureId)] ?? -1,
      head: s.head,
      headCount: s.headCount,
    });
    s.spatial = d.spatial;
    s.rank = d.rank;
  }
}

// ── Render ──────────────────────────────────────

/**
 * Renders the preview trace. Throws when the plugin is unknown or its wasm
 * cannot be loaded; plugin traps during rendering become trace notes.
 */
export async function renderPreview(input: PreviewInput, plugins: PreviewPlugins): Promise<Trace> {
  const m = input.modifier;
  const manifest = plugins.getManifest(m.plugin);
  if (!manifest) throw new Error(`plugin ${m.plugin} is not known (resolve it first)`);
  const [core, wasm] = await Promise.all([loadPreviewCore(), plugins.loadWasm(m.plugin)]);
  if (!wasm) throw new Error(`cannot load the wasm of plugin ${m.plugin}`);

  const signature = m.signature;
  const arity = ARITY[signature];
  const notes: string[] = [];
  const events: BridgeEvent[] = [];

  // Samples: observed fixtures the instance actually targets.
  const rendered = new Set(instanceTargets(m, input.layout).map(f => String(f.id)));
  const observed = input.targets.filter(f => rendered.has(String(f.id)));
  const skipped = input.targets.length - observed.length;
  if (skipped > 0) notes.push(`${skipped} target fixture(s) are not targeted by the modifier`);
  let samples = headSamples(observed, input.layout, input.groupIds);
  withSpread(samples, m, input.layout);

  // Readback requests: (group, head, signature, channel type | 255).
  const channelType = signature === 'scalar' && m.targetChannels[0] ? (CHANNEL_TYPE_ID[m.targetChannels[0]] ?? 255) : 255;
  const requests = new Uint32Array(samples.length * 4);
  samples.forEach((s, i) => requests.set([s.layoutIndex, s.head, SIGNATURE_ID[signature], channelType], i * 4));

  const frames = Math.max(0, Math.round(input.durationS * input.fps));
  const times = new Float64Array(frames);
  let values = samples.map(() => new Float32Array(frames * arity));

  const bridge = new WorkerPluginBridge(e => events.push(e));
  bridge.load(m.plugin, wasm);
  withPluginBridge(bridge, () => {
    const engine = new core.WasmEngine();
    try {
      engine.reset_clock(input.bpm);
      const layout = input.layout as Fixture[];
      const { packet, plugins: table } = buildModifiersBin([m], layout, plugins.getManifest);
      bridge.setTable(table);
      engine.dispatch(TYPE_LAYOUT_BIN, buildLayoutBin(layout).subarray(5));
      engine.dispatch(TYPE_CHAN_BIN, buildChannelsBin(layout).subarray(5));
      engine.dispatch(TYPE_MODIFIERS_BIN, packet.subarray(5));
      const dt = 1000 / input.fps;
      for (let f = 0; f < frames; f++) {
        const t = input.fromS + f / input.fps;
        times[f] = t;
        engine.render(t * 1000, dt);
        if (samples.length === 0) continue;
        const out = engine.read_head_signatures(requests);
        for (let s = 0; s < samples.length; s++) {
          for (let c = 0; c < arity; c++) values[s]![f * arity + c] = out[s * 3 + c]!;
        }
      }
    }
    finally {
      engine.free();
    }
  });

  // Heads without the signature's channels read NaN: drop them.
  if (frames > 0) {
    const keep = samples.map((_, s) => !Number.isNaN(values[s]![0]!));
    const dropped = keep.filter(k => !k).length;
    if (dropped > 0) notes.push(`${dropped} head(s) lack ${signature} channels`);
    samples = samples.filter((_, s) => keep[s]);
    values = values.filter((_, s) => keep[s]);
  }
  for (const e of events) {
    if (e.type === 'plugin-error') notes.push(`plugin ${manifest.name} failed (${e.reason}): ${e.message}`);
  }

  const traceSamples: TraceSample[] = samples.map(({ layoutIndex: _li, ...s }) => s);
  const source: TraceSource = {
    modifierId: m.id,
    pluginHash: m.plugin,
    pluginAlias: manifest.alias ?? manifest.name,
    output: manifest.output,
    blend: m.blendMode,
    strength: m.strength,
    spread: SPREADS[spreadKind(m.distribution)] ?? 'none',
  };
  const points = [...canvasPoints(manifest, m.params), ...(input.points ?? [])];
  return {
    mode: 'preview',
    signature,
    arity,
    fps: input.fps,
    fromS: input.fromS,
    durationS: input.durationS,
    bpm: input.bpm,
    times,
    samples: traceSamples,
    values,
    source,
    points: points.length > 0 ? points : undefined,
    handle: { origin: { ...m.distribution.origin }, end: { ...m.distribution.end } },
    // Only a beat-mode speed can lock to the beat (time / frozen speeds cannot).
    clock: m.speed.mode === 'beat' ? 'beat' : 'time',
    notes: notes.length > 0 ? notes : undefined,
  };
}
