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

/** The ready instance of a modifier, or null (starts loading). */
function instanceFor(m: ModifierInstance): PluginInstance | null {
  if (broken.has(m.plugin)) return null;
  const entry = instances.get(m.id);
  if (entry && entry.hash === m.plugin) {
    // Refresh LRU position.
    instances.delete(m.id);
    instances.set(m.id, entry);
    return entry.instance;
  }
  if (entry) instances.delete(m.id);
  load(m.id, m.plugin);
  return null;
}

/** Drops a modifier's preview instance (card removed). */
export function releasePreview(id: string): void {
  instances.delete(id);
}

// ── Sampling helpers (mirror rs-engine/core phase.rs / engine.rs) ─────

/** Values per sample by signature. */
const ARITY = { scalar: 1, rgb: 3, panTilt: 2 } as const;

/** Phase of the speed setting (cycles). */
function speedPhase(speed: SpeedConfig, timeMs: number, beatTime: number): number {
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

/** Spatial phase offset of a normalized position. */
function spatialOffset(m: ModifierInstance, x: number, y: number): number {
  if (m.fanning === 0 || m.direction === 'NONE') return 0;
  const dx = x - m.originX;
  const dy = y - m.originY;
  let d = 0;
  switch (m.direction) {
    case 'LINEAR': d = dx * Math.cos(m.angle) + dy * Math.sin(m.angle); break;
    case 'RADIAL': d = Math.hypot(dx, dy); break;
    case 'SYMMETRICAL': d = Math.abs(dx * Math.cos(m.angle) + dy * Math.sin(m.angle)); break;
    case 'ANGULAR': {
      let delta = Math.atan2(dy, dx) - m.angle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      d = delta / (2 * Math.PI);
      break;
    }
  }
  const offset = d / Math.max(m.fanning, 0.0001);
  return m.reverse ? -offset : offset;
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
  place: (i: number, sample: Float32Array, o: number) => void,
  opts: PreviewOptions,
): PreviewResult | null {
  const manifest = getManifest(m.plugin);
  const instance = manifest ? instanceFor(m) : null;
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

  const cseed = channelSeed(m.targetChannels[0] ?? 'DIMMER');
  const samples = new Float32Array(count * SAMPLE_FIELDS);
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_FIELDS;
    samples[o + SAMPLE.groupIndex] = i;
    samples[o + SAMPLE.groupCount] = count;
    samples[o + SAMPLE.headIndex] = 0;
    samples[o + SAMPLE.headCount] = 1;
    samples[o + SAMPLE.seed] = fmix32(Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(key, 0x85ebca6b)) & 0xffffff;
    for (let c = 0; c < 3; c++) samples[o + SAMPLE.base0 + c] = base[c] ?? 0;
    samples[o + SAMPLE.channelSeedLo] = cseed & 0xffff;
    samples[o + SAMPLE.channelSeedHi] = cseed >>> 16;
    place(i, samples, o);
  }

  try {
    instance.prepare(encodeParams(manifest.params, m.params));
    const out = instance.render(ctx, samples, count);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < arity; c++) {
        out[i * arity + c] = mapOutput(manifest.output, base[c] ?? 0, out[i * arity + c]!, m.strength);
      }
    }
    return { values: out, arity };
  }
  catch (err) {
    if (err instanceof PluginTrap) {
      broken.add(m.plugin);
      instances.delete(m.id);
      console.warn(`[preview-pool] ${manifest.name} trapped (${err.reason}): ${err.message}`);
      return null;
    }
    throw err;
  }
}

// ── Public renders ─────────────────────────────────

/**
 * One cycle of the modifier over `count` samples (card preview): phase runs
 * 0 → 1 left to right, positions spread along x.
 */
export function renderCycle(m: ModifierInstance, count: number, opts: PreviewOptions = {}): PreviewResult | null {
  return render(m, count, (i, s, o) => {
    s[o + SAMPLE.x] = count > 1 ? i / (count - 1) : 0.5;
    s[o + SAMPLE.y] = 0.5;
    s[o + SAMPLE.phase] = i / count;
  }, opts);
}

/**
 * The modifier over a `cols × rows` grid covering the normalized world at
 * `opts.timeMs` (canvas overlay): phase = speed phase − spatial offset, as in
 * the engine.
 */
export function renderField(m: ModifierInstance, cols: number, rows: number, opts: PreviewOptions = {}): PreviewResult | null {
  const timeMs = opts.timeMs ?? 0;
  const bpm = opts.bpm ?? 120;
  const sp = speedPhase(m.speed, timeMs, (timeMs / 60000) * bpm);
  return render(m, cols * rows, (i, s, o) => {
    const x = ((i % cols) + 0.5) / cols;
    const y = (Math.floor(i / cols) + 0.5) / rows;
    s[o + SAMPLE.x] = x;
    s[o + SAMPLE.y] = y;
    s[o + SAMPLE.phase] = sp - spatialOffset(m, x, y);
  }, opts);
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
