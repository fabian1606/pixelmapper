/**
 * Validation harness (ADR §6.7).
 *
 * Instantiates a plugin against a synthetic layout (64 fixtures × 1–8 heads),
 * renders 240 frames (4 s @ 60 fps) for several param variants and every
 * declared signature, and rejects: invalid manifest, forbidden imports,
 * uninstrumented modules, traps/aborts/budget overruns, NaN/∞, outputs out of
 * range (`absolute` [0, 1]; `bipolar` [−2, 2], amendment A13), state across
 * frames (frame 120 after 0–119 ≠ frame 120 fresh), and > 2 ms median per
 * frame scaled to 512 samples. Warns on constant output.
 */
import { PARAM_WIRE_SLOTS, SIGNATURE_ARITY, type ParamSchema, type ParamValue, type Signature } from '@pixelmapper/extension-api';
import { validateManifest } from './manifest';
import { encodeParams } from './params';
import { CTX, CTX_FIELDS, PluginInstance, PluginTrap, SAMPLE, SAMPLE_FIELDS, forbiddenImports } from './runtime';
import type { ContentPluginManifest } from './types';

/** Harness outcome. */
export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    /** Median render time per frame, scaled to 512 samples. */
    medianFrameMs: number;
    /** Samples per frame in the synthetic layout. */
    samples: number;
    frames: number;
    outputMin: number;
    outputMax: number;
  };
}

/** Options (smaller values speed up tests). */
export interface ValidateOptions {
  frames?: number;
  /** Max median ms per frame at 512 samples (default 2). */
  maxFrameMs?: number;
  /** Skip the timing check (e.g. on slow CI). */
  skipPerf?: boolean;
}

const FIXTURES = 64;
const RANGE: Record<ContentPluginManifest['output'], [number, number]> = { absolute: [0, 1], bipolar: [-2, 2] };
const TOLERANCE = 1e-4;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Param variants: defaults, all-min, all-max, random. */
function paramVariants(schema: ParamSchema): { name: string; values: Record<string, ParamValue> }[] {
  const pick = (mode: 'min' | 'max' | 'rand', r: () => number) => {
    const out: Record<string, ParamValue> = {};
    for (const p of schema) {
      switch (p.type) {
        case 'number':
        case 'int': {
          const v = mode === 'min' ? p.min : mode === 'max' ? p.max : p.min + r() * (p.max - p.min);
          out[p.key] = p.type === 'int' ? Math.round(v) : v;
          break;
        }
        case 'bool': out[p.key] = mode === 'max' || (mode === 'rand' && r() > 0.5); break;
        case 'enum': out[p.key] = p.options[mode === 'min' ? 0 : mode === 'max' ? p.options.length - 1 : Math.floor(r() * p.options.length)]!; break;
        case 'color': out[p.key] = mode === 'rand' ? { r: r(), g: r(), b: r() } : { r: mode === 'max' ? 1 : 0, g: mode === 'max' ? 1 : 0, b: mode === 'max' ? 1 : 0 }; break;
        case 'angle': out[p.key] = mode === 'min' ? 0 : mode === 'max' ? Math.PI * 2 : r() * Math.PI * 2; break;
        case 'point': out[p.key] = mode === 'rand' ? { x: r(), y: r() } : { x: mode === 'max' ? 1 : 0, y: mode === 'max' ? 1 : 0 }; break;
        case 'curve': out[p.key] = mode === 'rand' ? [{ x: 0, y: r() }, { x: 0.5, y: r() }, { x: 1, y: r() }] : p.default; break;
      }
    }
    return out;
  };
  const r = rng(0x5eed);
  const variants = [{ name: 'defaults', values: {} as Record<string, ParamValue> }];
  if (schema.length > 0) {
    variants.push({ name: 'min', values: pick('min', r) }, { name: 'max', values: pick('max', r) }, { name: 'random', values: pick('rand', r) });
  }
  return variants;
}

/** Synthetic samples: 64 fixtures on an 8×8 grid with 1–8 heads each. */
function syntheticSamples(): { samples: Float32Array; count: number } {
  const heads: { x: number; y: number; g: number; h: number; hc: number }[] = [];
  for (let g = 0; g < FIXTURES; g++) {
    const hc = 1 + (g % 8);
    for (let h = 0; h < hc; h++) {
      heads.push({ x: ((g % 8) + 0.5 + (h - hc / 2) * 0.05) / 8, y: (Math.floor(g / 8) + 0.5) / 8, g, h, hc });
    }
  }
  const samples = new Float32Array(heads.length * SAMPLE_FIELDS);
  heads.forEach((hd, i) => {
    const o = i * SAMPLE_FIELDS;
    samples[o + SAMPLE.x] = hd.x;
    samples[o + SAMPLE.y] = hd.y;
    samples[o + SAMPLE.groupIndex] = hd.g;
    samples[o + SAMPLE.groupCount] = FIXTURES;
    samples[o + SAMPLE.headIndex] = hd.h;
    samples[o + SAMPLE.headCount] = hd.hc;
    samples[o + SAMPLE.seed] = (Math.imul(hd.g + 1, 2654435761) ^ (hd.h * 40503)) & 0xffffff;
    samples[o + SAMPLE.base0] = hd.x;
    samples[o + SAMPLE.base1] = hd.y;
    samples[o + SAMPLE.base2] = 0.5;
    samples[o + SAMPLE.channelSeedLo] = (i * 7919) & 0xffff;
    samples[o + SAMPLE.channelSeedHi] = (i * 104729) & 0xffff;
  });
  return { samples, count: heads.length };
}

/** Writes frame `f` into ctx and the phase column of the samples. */
function setFrame(ctx: Float32Array, samples: Float32Array, count: number, f: number, arity: number): void {
  const t = (f * 1000) / 60;
  ctx.fill(0);
  ctx[CTX.timeMs] = t;
  ctx[CTX.bpm] = 120;
  ctx[CTX.beatTime] = (t * 120) / 60000;
  ctx[CTX.phaseSpeed] = 1;
  ctx[CTX.arity] = arity;
  ctx[CTX.seedLo] = 0x1234;
  ctx[CTX.seedHi] = 0x5678;
  ctx[CTX.strength] = 1;
  for (let i = 0; i < count; i++) {
    const o = i * SAMPLE_FIELDS;
    samples[o + SAMPLE.phase] = t / 1000 - samples[o + SAMPLE.x]! * 0.5;
  }
}

/** Runs the harness. */
export async function validate(
  pkg: { manifest: ContentPluginManifest; wasm: Uint8Array },
  opts: ValidateOptions = {},
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const frames = opts.frames ?? 240;
  const metrics = { medianFrameMs: 0, samples: 0, frames, outputMin: Infinity, outputMax: -Infinity };
  const report = () => ({ ok: errors.length === 0, errors, warnings, metrics });

  const mv = validateManifest(pkg.manifest);
  if (!mv.ok) {
    errors.push(...mv.errors.map(e => `manifest: ${e}`));
    return report();
  }
  const manifest = pkg.manifest;

  let module: WebAssembly.Module;
  try {
    module = await WebAssembly.compile(new Uint8Array(pkg.wasm));
  }
  catch (err) {
    errors.push(`invalid WebAssembly: ${(err as Error).message}`);
    return report();
  }
  const bad = forbiddenImports(module);
  if (bad.length > 0) errors.push(`forbidden imports: ${bad.join(', ')}`);
  if (!WebAssembly.Module.imports(module).some(i => i.module === 'pm' && i.name === 'budget')) {
    errors.push('module is not instrumented (missing pm.budget import)');
  }
  if (errors.length > 0) return report();

  const { samples, count } = syntheticSamples();
  metrics.samples = count;
  const ctx = new Float32Array(CTX_FIELDS);
  const [lo, hi] = RANGE[manifest.output];
  const times: number[] = [];
  let constant = true;
  let first: number | null = null;

  for (const signature of manifest.signatures as Signature[]) {
    const arity = SIGNATURE_ARITY[signature];
    for (const variant of paramVariants(manifest.params)) {
      const label = `${signature}/${variant.name}`;
      let inst: PluginInstance;
      try {
        inst = await PluginInstance.create(module);
        inst.prepare(encodeParams(manifest.params, variant.values));
      }
      catch (err) {
        errors.push(`${label}: ${err instanceof PluginTrap ? err.message : String(err)}`);
        continue;
      }
      const out = new Float32Array(count * arity);
      let frame120: Float32Array | null = null;
      for (let f = 0; f < frames; f++) {
        setFrame(ctx, samples, count, f, arity);
        const t0 = performance.now();
        try {
          inst.render(ctx, samples, count, out);
        }
        catch (err) {
          errors.push(`${label} frame ${f}: ${err instanceof PluginTrap ? err.message : String(err)}`);
          break;
        }
        if (variant.name === 'defaults') times.push(performance.now() - t0);
        let bad: string | null = null;
        for (let i = 0; i < out.length; i++) {
          const v = out[i]!;
          if (!Number.isFinite(v)) { bad = `non-finite output ${v}`; break; }
          if (v < lo - TOLERANCE || v > hi + TOLERANCE) { bad = `output ${v} outside [${lo}, ${hi}] for "${manifest.output}"`; break; }
          if (v < metrics.outputMin) metrics.outputMin = v;
          if (v > metrics.outputMax) metrics.outputMax = v;
          if (first === null) first = v;
          else if (v !== first) constant = false;
        }
        if (bad) {
          errors.push(`${label} frame ${f}: ${bad}`);
          break;
        }
        if (f === Math.min(120, frames - 1)) frame120 = out.slice();
      }

      // Determinism: frame 120 after 0–119 vs. a fresh instance.
      if (variant.name === 'defaults' && frame120) {
        try {
          const fresh = await PluginInstance.create(module);
          fresh.prepare(encodeParams(manifest.params, variant.values));
          setFrame(ctx, samples, count, Math.min(120, frames - 1), arity);
          const again = fresh.render(ctx, samples, count);
          const a = new Uint32Array(frame120.buffer);
          const b = new Uint32Array(again.buffer);
          if (a.some((v, i) => v !== b[i])) errors.push(`${label}: non-deterministic (output depends on previous frames)`);
        }
        catch (err) {
          errors.push(`${label} determinism run: ${String(err)}`);
        }
      }
    }
  }

  if (times.length > 0) {
    const sorted = [...times].sort((a, b) => a - b);
    metrics.medianFrameMs = (sorted[Math.floor(sorted.length / 2)]! * 512) / count;
    if (!opts.skipPerf && metrics.medianFrameMs > (opts.maxFrameMs ?? 2)) {
      errors.push(`too slow: ${metrics.medianFrameMs.toFixed(2)} ms median per frame at 512 samples (max ${opts.maxFrameMs ?? 2})`);
    }
  }
  if (constant && errors.length === 0) warnings.push('output is constant for all frames, params and samples');
  if (!Number.isFinite(metrics.outputMin)) { metrics.outputMin = 0; metrics.outputMax = 0; }

  // Unused-slot sanity: params block length matches the schema.
  const slots = manifest.params.reduce((n, p) => n + PARAM_WIRE_SLOTS[p.type], 0);
  if (slots > 4096) warnings.push(`large params block (${slots} f32 slots)`);

  return report();
}
