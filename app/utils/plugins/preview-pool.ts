/**
 * Preview pool (plan P3.14, ADR §6.6).
 *
 * Main-thread plugin instances that render modifier previews without the
 * engine worker: the curve/strip on a modifier card and the field overlay on
 * the canvas while dragging spatial handles. Compiled modules are cached per
 * content hash; instances per modifier id (LRU) so stateful plugins keep
 * their own state. A plugin that traps is marked broken and previews return
 * null — the worker's error path stays authoritative.
 *
 * Rendering is synchronous once an instance exists; the first request starts
 * loading and returns null. `previewRevision` bumps when an instance becomes
 * ready so callers re-render.
 */
import { shallowRef } from 'vue';
import { CTX, CTX_FIELDS, PluginInstance, PluginTrap, SAMPLE, SAMPLE_FIELDS } from '@pixelmapper/plugin-toolchain/runtime';
import { encodeParams } from '@pixelmapper/plugin-toolchain/params';
import type { ModifierInstance, SpeedConfig } from '~/utils/engine/types';
import { modifierKey } from '~/utils/engine/modifiers';
import { getManifest, loadWasm } from './plugin-store';
import { mapOutput } from './host-mapping';
import { frameCounts, groupOf, hasGrouping, QUANTIZED_RANKS, sampleDistribution, spreadKind } from '~/utils/engine/distribution/sample';
import type { DistributionSampleInput } from '~/utils/engine/distribution/sample';

// ── Pool state ─────────────────────────────────────

/** Maximum live preview instances (oldest evicted first). */
const MAX_INSTANCES = 32;

/** Bumped whenever an instance becomes ready (reactive dependency). */
export const previewRevision = shallowRef(0);

const modules = new Map<string, Promise<WebAssembly.Module | null>>();
/** Instances by modifier id; Map order doubles as LRU order. */
const instances = new Map<string, { hash: string; instance: PluginInstance }>();
const pending = new Set<string>();
/** Hashes that trapped in a preview. */
const broken = new Set<string>();

/** Compiled module of a plugin (cached per hash). */
function moduleOf(hash: string): Promise<WebAssembly.Module | null> {
  let m = modules.get(hash);
  if (!m) {
    m = loadWasm(hash).then(bytes => (bytes ? WebAssembly.compile(bytes as BufferSource) : null)).catch((err) => {
      console.warn(`[preview-pool] cannot compile ${hash}:`, err);
      return null;
    });
    modules.set(hash, m);
  }
  return m;
}

/** Starts creating the instance for a modifier (no-op when pending). */
function load(id: string, hash: string): void {
  if (pending.has(id)) return;
  pending.add(id);
  void moduleOf(hash)
    .then(module => (module ? PluginInstance.create(module) : null))
    .then((instance) => {
      if (!instance) return;
      instances.set(id, { hash, instance });
      while (instances.size > MAX_INSTANCES) instances.delete(instances.keys().next().value!);
      previewRevision.value++;
    })
    .catch((err) => {
      broken.add(hash);
      console.warn(`[preview-pool] cannot instantiate ${hash}:`, err);
    })
    .finally(() => pending.delete(id));
}

/**
 * The ready instance of a modifier, or null (starts loading). `key` names
 * the pool slot (default: the modifier id); callers previewing a modifier
 * outside its card pass their own key so stateful plugins do not share state.
 */
function instanceFor(m: ModifierInstance, key: string = m.id): PluginInstance | null {
  if (broken.has(m.plugin)) return null;
  const entry = instances.get(key);
  if (entry && entry.hash === m.plugin) {
    // Refresh LRU position.
    instances.delete(key);
    instances.set(key, entry);
    return entry.instance;
  }
  if (entry) instances.delete(key);
  load(key, m.plugin);
  return null;
}

/** Drops a preview instance by modifier id or instance key (card removed). */
export function releasePreview(id: string): void {
  instances.delete(id);
}

// ── Sampling helpers (mirror rs-engine/core phase.rs / engine.rs) ─────

/** Values per sample by signature. */
const ARITY = { scalar: 1, rgb: 3, panTilt: 2 } as const;

/** Phase of the speed setting (cycles). */
export function speedPhase(speed: SpeedConfig, timeMs: number, beatTime: number): number {
  if (speed.mode === 'time' && speed.timeMs > 0) return timeMs / speed.timeMs;
  if (speed.mode === 'beat' && speed.beatValue > 0) return (beatTime + speed.beatOffset) / speed.beatValue;
  return 0;
}

/** Phase advance per second. */
function phaseSpeed(speed: SpeedConfig, bpm: number): number {
  if (speed.mode === 'time' && speed.timeMs > 0) return 1000 / speed.timeMs;
  if (speed.mode === 'beat' && speed.beatValue > 0) return bpm / 60 / speed.beatValue;
  return 0;
}

/** Murmur3 finalizer (sample seeds). */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a of a channel type name (scalar channel seed). */
function channelSeed(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Default working value shown under a preview, by signature. */
function defaultBase(signature: ModifierInstance['signature']): number[] {
  if (signature === 'rgb') return [1, 0.35, 0];
  if (signature === 'panTilt') return [0.5, 0.5];
  return [1];
}

/** Options of a preview render. */
export interface PreviewOptions {
  /** Time in ms (default 0). */
  timeMs?: number;
  /** Tempo for beat speeds (default 120). */
  bpm?: number;
  /** Working values under the modifier (default per signature). */
  base?: number[];
  /** Order ranks of the instance on the stage (strip / encoding ticks); 0 = unknown. */
  rankCount?: number;
  /** Time phase override (cycles) instead of deriving it from the speed. */
  timePhase?: number;
  /** Return the plugin's raw output (no host mapping). */
  raw?: boolean;
  /**
   * Pool slot of the plugin instance (default: the modifier id). The sample
   * seeds still derive from the modifier id, so results match the engine.
   */
  instanceKey?: string;
  /** Ticks for curve params (default `rankCount`). */
  ticks?: number;
}

/** Position and distribution values of one preview sample. */
interface Placed {
  x: number;
  y: number;
  spatial: number;
  rank: number;
  group: number;
  /** Index of the sample's fixture among the targeted ones and their count (default i / count). */
  fixture?: number;
  fixtureCount?: number;
  /** Head index / count within the fixture (default 0 / 1). */
  head?: number;
  headCount?: number;
  /** Working values under the modifier for this sample (default `opts.base`). */
  base?: readonly number[];
}

/** One rendered preview: `count × arity` values after host blending. */
export interface PreviewResult {
  values: Float32Array;
  arity: number;
}

/**
 * Renders `count` samples whose positions/phases come from `place`, then
 * applies the host mapping (`mapOutput`: bipolar, absolute or scale), clamped
 * to [0, 1].
 */
function render(
  m: ModifierInstance,
  count: number,
  place: (i: number) => Placed,
  opts: PreviewOptions,
  maxHeads = 1,
): PreviewResult | null {
  const manifest = getManifest(m.plugin);
  const instance = manifest ? instanceFor(m, opts.instanceKey) : null;
  if (!manifest || !instance) return null;

  const arity = ARITY[m.signature] ?? 1;
  const base = opts.base ?? defaultBase(m.signature);
  const timeMs = opts.timeMs ?? 0;
  const bpm = opts.bpm ?? 120;
  const key = modifierKey(m.id);

  const ctx = new Float32Array(CTX_FIELDS);
  ctx[CTX.timeMs] = timeMs;
  ctx[CTX.beatTime] = (timeMs / 60000) * bpm;
  ctx[CTX.bpm] = bpm;
  ctx[CTX.phaseSpeed] = phaseSpeed(m.speed, bpm);
  ctx[CTX.arity] = arity;
  ctx[CTX.seedLo] = key & 0xffff;
  ctx[CTX.seedHi] = key >>> 16;
  ctx[CTX.strength] = m.strength;
  const tp = opts.timePhase ?? speedPhase(m.speed, timeMs, ctx[CTX.beatTime]!);
  const rankCount = opts.rankCount ?? 0;
  const counts = frameCounts(m.distribution, rankCount, maxHeads);
  ctx[CTX.timePhase] = tp;
  ctx[CTX.rankCount] = counts.rankCount;
  ctx[CTX.distGroupCount] = counts.distGroupCount;
  ctx[CTX.spread] = spreadKind(m.distribution);
  ctx[CTX.handleOriginX] = m.distribution.origin.x;
  ctx[CTX.handleOriginY] = m.distribution.origin.y;
  ctx[CTX.handleEndX] = m.distribution.end.x;
  ctx[CTX.handleEndY] = m.distribution.end.y;
  // v1.3: previews place samples in a unit room (u, v = x, y; flat floor).
  ctx[CTX.worldAspect] = 1;
  ctx[CTX.worldDepth] = 1;

  const cseed = channelSeed(m.targetChannels[0] ?? 'DIMMER');
  const samples = new Float32Array(count * SAMPLE_FIELDS);
  /** Per-sample bases (only when a placement overrides the base). */
  let bases: (readonly number[])[] | null = null;
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_FIELDS;
    const p = place(i);
    const sampleBase = p.base ?? base;
    if (p.base) (bases ??= new Array(count).fill(base))[i] = p.base;
    samples[o + SAMPLE.groupIndex] = p.fixture ?? i;
    samples[o + SAMPLE.groupCount] = p.fixtureCount ?? count;
    samples[o + SAMPLE.headIndex] = p.head ?? 0;
    samples[o + SAMPLE.headCount] = p.headCount ?? 1;
    samples[o + SAMPLE.seed] = fmix32(Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(key, 0x85ebca6b)) & 0xffffff;
    for (let c = 0; c < 3; c++) samples[o + SAMPLE.base0 + c] = sampleBase[c] ?? 0;
    samples[o + SAMPLE.channelSeedLo] = cseed & 0xffff;
    samples[o + SAMPLE.channelSeedHi] = cseed >>> 16;
    samples[o + SAMPLE.x] = p.x;
    samples[o + SAMPLE.y] = p.y;
    samples[o + SAMPLE.u] = p.x;
    samples[o + SAMPLE.v] = p.y;
    samples[o + SAMPLE.phase] = tp - p.spatial;
    samples[o + SAMPLE.spatial] = p.spatial;
    samples[o + SAMPLE.rank] = p.rank;
    samples[o + SAMPLE.distGroup] = p.group;
  }

  try {
    instance.prepare(encodeParams(manifest.params, m.params, { ticks: opts.ticks ?? rankCount }));
    const out = instance.render(ctx, samples, count);
    if (opts.raw) return { values: out, arity };
    for (let i = 0; i < count; i++) {
      const b = bases?.[i] ?? base;
      for (let c = 0; c < arity; c++) {
        out[i * arity + c] = mapOutput(manifest.output, b[c] ?? 0, out[i * arity + c]!, m.strength);
      }
    }
    return { values: out, arity };
  }
  catch (err) {
    if (err instanceof PluginTrap) {
      broken.add(m.plugin);
      instances.delete(opts.instanceKey ?? m.id);
      console.warn(`[preview-pool] ${manifest.name} trapped (${err.reason}): ${err.message}`);
      return null;
    }
    throw err;
  }
}

// ── Public renders ─────────────────────────────────

/**
 * One cycle of the modifier over `count` samples at time 0 (legacy card
 * preview): spatial runs 0 → −1 left to right, so the legacy phase runs
 * 0 → 1; positions spread along x.
 */
export function renderCycle(m: ModifierInstance, count: number, opts: PreviewOptions = {}): PreviewResult | null {
  return render(m, count, i => ({ x: count > 1 ? i / (count - 1) : 0.5, y: 0.5, spatial: -i / count, rank: -1, group: -1 }), { ...opts, timeMs: 0 });
}

/**
 * The modifier over a `cols × rows` grid covering the normalized world at
 * `opts.timeMs` (canvas overlay): per-point distribution as in the engine
 * (grid points carry no fixture rank).
 */
export function renderField(m: ModifierInstance, cols: number, rows: number, opts: PreviewOptions = {}): PreviewResult | null {
  const d = m.distribution;
  return render(m, cols * rows, (i) => {
    const x = ((i % cols) + 0.5) / cols;
    const y = (Math.floor(i / cols) + 0.5) / rows;
    return { x, y, ...sampleDistribution(d, 0, { x, y, fixtureRank: -1, head: 0, headCount: 1 }) };
  }, opts);
}

/**
 * Endless strip (plan M3.6): `cols` virtual samples with a continuous
 * `spatial = i / cols` ("infinitely many pixels"). Ranks come from
 * `opts.rankCount` (16 when unknown); with grouping, every sample takes its
 * group's position, as on the stage. Reverse applies as in the engine.
 */
export function renderStrip(m: ModifierInstance, cols: number, opts: PreviewOptions = {}): PreviewResult | null {
  const d = m.distribution;
  const rc = opts.rankCount && opts.rankCount > 0 ? opts.rankCount : QUANTIZED_RANKS;
  return render(m, cols, (i) => {
    const rank = Math.min(rc - 1, Math.floor((i * rc) / cols));
    let spatial = i / cols;
    let group = -1;
    if (hasGrouping(d)) {
      group = groupOf(d, rank, rc);
      spatial = group / Math.floor(d.grouping.n);
    }
    if (d.reverse) spatial = 1 - spatial;
    return { x: cols > 1 ? i / (cols - 1) : 0.5, y: 0.5, spatial, rank, group };
  }, { ...opts, rankCount: rc });
}

/**
 * Raw plugin output of `count` neighbouring virtual fixtures (one 16th
 * apart along the spread) over `cycles` time units (`points` samples each),
 * one array per fixture (noise history editor: coherent neighbours follow
 * each other).
 */
export function renderTraces(m: ModifierInstance, count: number, points: number, cycles: number): Float32Array[] | null {
  const traces = Array.from({ length: count }, () => new Float32Array(points));
  for (let p = 0; p < points; p++) {
    const r = render(m, count, i => ({ x: 0.3 + 0.05 * i, y: 0.5, spatial: i / QUANTIZED_RANKS, rank: i, group: -1 }), { timePhase: (p / points) * cycles, raw: true, rankCount: QUANTIZED_RANKS });
    if (!r) return null;
    for (let i = 0; i < count; i++) traces[i]![p] = r.values[i * r.arity]!;
  }
  return traces;
}

/** One fixture sample of `renderPoints` (normalized world position). */
export interface PreviewPoint extends DistributionSampleInput {
  /** Index of the point's fixture among the targeted fixtures and their count (engine `groupIndex` / `groupCount`). */
  fixture?: number;
  fixtureCount?: number;
  /** Working values under the modifier (default `opts.base` / per signature). */
  base?: readonly number[];
}

/**
 * The modifier at arbitrary fixture samples at `opts.timeMs` (version
 * preview of an effect on the snapshot's fixtures): per-sample distribution
 * as in the engine (`sampleDistribution` with the fixture's order rank and
 * head). `opts.rankCount` is the instance's order rank count (from
 * `resolveRanks`, 0 when the distribution has no ranks); the largest
 * `headCount` sets the rank count of scope `within`.
 */
export function renderPoints(m: ModifierInstance, points: readonly PreviewPoint[], opts: PreviewOptions = {}): PreviewResult | null {
  const d = m.distribution;
  const rankCount = opts.rankCount ?? 0;
  let maxHeads = 1;
  for (const p of points) maxHeads = Math.max(maxHeads, p.headCount);
  return render(m, points.length, (i) => {
    const p = points[i]!;
    return { x: p.x, y: p.y, fixture: p.fixture, fixtureCount: p.fixtureCount, head: p.head, headCount: p.headCount, base: p.base, ...sampleDistribution(d, rankCount, p) };
  }, opts, maxHeads);
}

/** Converts preview values to CSS-ready RGB bytes (scalar → gray, panTilt → x/y as r/g). */
export function previewRgb(result: PreviewResult, i: number): [number, number, number] {
  const { values, arity } = result;
  const o = i * arity;
  if (arity === 3) return [values[o]! * 255, values[o + 1]! * 255, values[o + 2]! * 255];
  if (arity === 2) return [values[o]! * 255, values[o + 1]! * 255, 128];
  const v = values[o]! * 255;
  return [v, v, v];
}
