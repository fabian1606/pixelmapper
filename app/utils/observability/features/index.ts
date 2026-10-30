/**
 * Feature extraction of an observation trace (ADR 0002 §6.3, plan M2).
 *
 * `analyzeTrace` turns a `Trace` into the `ObservationJson` (subject of
 * the observe expectations) plus findings. Group features aggregate over
 * samples (heads); fixture features pool their heads (range max = the
 * brightest head) and list per-head records (`heads[i]`, see `heads.ts`).
 */
import type { Finding } from '@pixelmapper/agent-kit';
import type { Trace, TraceSample } from '../types';
import type { AnalyzeOptions, FixtureFeatures, GroupFeatures, ObservationJson, ObservationSource } from './types';
import type { Signal } from './signal';
import type { SpatialSample, SpatialContext } from './spatial';
import type { TemporalContext } from './temporal';
import { componentNames, componentSignal, intensitySeries, makeSignal, meanComponents, round4, signalIssues, splitComponents } from './signal';
import { rangeOf } from './range';
import { analyzeColor } from './color';
import { analyzeTemporal } from './temporal';
import { analyzeSpatial, phaseLags } from './spatial';
import { analyzeRadial } from './radial';
import { analyzeMirror } from './mirror';
import { headFeatures, onsetLevel, orderOf } from './heads';

export type * from './types';

// ── Preparation ─────────────────────────────────

/** A trace sample with its prepared signal. */
interface Prepared {
  sample: TraceSample;
  signal: Signal;
  /** First onset (s, relative), from the all-samples mid level. */
  onset?: number;
  /** Index in trace (layout) order. */
  index: number;
}

/** Shared context of one analysis. */
interface Context extends TemporalContext, SpatialContext {
  trace: Trace;
}

/** Position along the spread of a sample (`spatial`, else a valid `rank`). */
function spreadOf(s: TraceSample): number | undefined {
  if (s.spatial !== undefined && Number.isFinite(s.spatial)) return s.spatial;
  if (s.rank !== undefined && s.rank >= 0) return s.rank;
  return undefined;
}

/** Group issue codes (fixed order) over prepared samples. */
function groupIssues(prepared: Prepared[]): string[] {
  if (prepared.length === 0) return ['no-targets'];
  const all = prepared.map(p => signalIssues(p.signal));
  const any = (code: string) => all.some(i => i.includes(code));
  const issues: string[] = [];
  if (any('nan')) issues.push('nan');
  if (prepared.every(p => p.signal.constant)) issues.push('constant');
  for (const code of ['stuck-0', 'stuck-1', 'clamped']) if (any(code)) issues.push(code);
  return issues;
}

// ── Group ───────────────────────────────────────

/** Aggregated features over a set of prepared samples. */
function groupFeatures(prepared: Prepared[], ctx: Context): GroupFeatures {
  const { trace } = ctx;
  const signals = prepared.map(p => p.signal);
  const names = componentNames(trace.signature);
  // Per component: range and univariate temporal verdict.
  const components: GroupFeatures['components'] = {};
  names.forEach((name, c) => {
    const comp = signals.map(s => componentSignal(s, c));
    components[name] = { range: rangeOf(comp.map(s => s.comps[0]!)), temporal: analyzeTemporal(comp, ctx) };
  });
  const range = trace.signature === 'panTilt' ? rangeOf(signals.flatMap(s => s.comps)) : rangeOf(signals.map(s => s.intensity));
  const temporal = analyzeTemporal(signals, ctx);
  const lags = temporal.kind === 'periodic' ? phaseLags(signals, temporal.hz, trace.fps) : null;
  const spatialSamples: SpatialSample[] = prepared.map(p => ({ x: p.sample.x, y: p.sample.y, spread: spreadOf(p.sample), signal: p.signal }));
  const radial = trace.points && trace.points.length > 0 ? analyzeRadial(spatialSamples, trace.points, temporal, lags, ctx.times) : null;
  const mirror = analyzeMirror(spatialSamples, trace.mirrorAxes);
  const order = orderOf(prepared.map(p => ({
    key: `${p.sample.fixtureId}.${p.sample.head}`,
    spread: spreadOf(p.sample),
    layout: p.index,
    onset: p.onset,
  })), 1 / trace.fps);
  // Optional keys are spread in place to keep the documented key order.
  return {
    count: new Set(prepared.map(p => String(p.sample.fixtureId))).size,
    samples: prepared.length,
    components,
    range,
    ...(trace.signature === 'rgb' ? { color: analyzeColor(signals) } : {}),
    temporal,
    spatial: analyzeSpatial(spatialSamples, temporal, lags, ctx),
    ...(radial ? { radial } : {}),
    ...(mirror ? { mirror } : {}),
    ...(order ? { order } : {}),
    active: round4(prepared.length > 0 ? signals.filter(s => !s.constant).length / prepared.length : 0),
    issues: groupIssues(prepared),
  };
}

// ── Fixtures ────────────────────────────────────

/** Prepared samples grouped by fixture id (trace order). */
function byFixture(prepared: Prepared[]): Map<string, Prepared[]> {
  const map = new Map<string, Prepared[]>();
  for (const p of prepared) {
    const key = String(p.sample.fixtureId);
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
}

/** Merged (head mean) signal of a fixture. */
function fixtureSignal(heads: Prepared[], trace: Trace): Signal {
  const merged = makeSignal(meanComponents(heads.map(h => h.signal)), comps => intensitySeries(comps, trace.signature));
  merged.hasNaN = heads.some(h => h.signal.hasNaN);
  merged.allNaN = heads.every(h => h.signal.allNaN);
  return merged;
}

/**
 * Features of one fixture from its heads: range pooled over heads and
 * frames (max = brightest head, mean = average), temporal / color over the
 * heads jointly, issues of the head mean, plus one record per head.
 */
function fixtureFeatures(heads: Prepared[], signal: Signal, ctx: Context, level: number | null): FixtureFeatures {
  const first = heads[0]!.sample;
  const avg = (f: (s: TraceSample) => number) => heads.reduce((acc, h) => acc + f(h.sample), 0) / heads.length;
  const signals = heads.map(h => h.signal);
  const range = ctx.trace.signature === 'panTilt' ? rangeOf(signals.flatMap(s => s.comps)) : rangeOf(signals.map(s => s.intensity));
  return {
    name: first.fixtureName,
    x: round4(avg(s => s.x)),
    y: round4(avg(s => s.y)),
    heads: [...heads].sort((a, b) => a.sample.head - b.sample.head).map(h => headFeatures(h.signal, level, ctx.times)),
    range,
    ...(ctx.trace.signature === 'rgb' ? { color: analyzeColor(signals) } : {}),
    temporal: analyzeTemporal(signals, ctx),
    issues: signalIssues(signal),
  };
}

// ── Findings ────────────────────────────────────

/** Findings of an analysis. */
function collectFindings(trace: Trace, prepared: Prepared[], fixtures: Map<string, { signal: Signal; name: string }>): Finding[] {
  const findings: Finding[] = [];
  if (prepared.length === 0) {
    findings.push({ level: 'warning', code: 'observe-zero-targets', message: 'No samples were observed: the targets resolved to no fixtures (or none with this signature).' });
  }
  const nanIds = [...fixtures].filter(([, f]) => f.signal.hasNaN).map(([id]) => `fixture:${id}`);
  if (nanIds.length > 0) {
    findings.push({ level: 'info', code: 'observe-unavailable-values', message: `${nanIds.length} fixture(s) had unavailable (NaN) values; they were filled with the component mean.`, entityIds: nanIds });
  }
  if (prepared.length > 0 && prepared.every(p => p.signal.constant)) {
    findings.push({ level: 'info', code: 'observe-constant-output', message: 'All observed samples are constant over the window.' });
  }
  const stuck = [...fixtures].map(([id, f]) => ({ id, name: f.name, issues: signalIssues(f.signal) })).filter(f => f.issues.includes('stuck-0') || f.issues.includes('stuck-1'));
  if (stuck.length > 0) {
    const list = stuck.slice(0, 6).map(f => `${f.name} (${f.issues.includes('stuck-0') ? '0' : '1'})`).join(', ');
    findings.push({
      level: 'warning',
      code: 'observe-stuck',
      message: `${stuck.length} fixture(s) stuck at 0/1: ${list}${stuck.length > 6 ? ', …' : ''}.`,
      entityIds: stuck.map(f => `fixture:${f.id}`),
    });
  }
  for (const note of trace.notes ?? []) findings.push({ level: 'info', code: 'observe-note', message: note });
  return findings;
}

// ── Entry point ─────────────────────────────────

/** Sources of a trace for the JSON. */
function sourcesOf(trace: Trace): ObservationSource[] {
  const s = trace.source;
  if (!s) return [];
  const src: ObservationSource = { plugin: s.pluginAlias ?? s.pluginHash, hash: s.pluginHash, output: s.output, blend: s.blend, strength: round4(s.strength), spread: s.spread };
  return [s.modifierId ? { plugin: src.plugin, hash: src.hash, modifierId: s.modifierId, output: src.output, blend: src.blend, strength: src.strength, spread: src.spread } : src];
}

/** Analyzes a trace into feature JSON and findings. */
export function analyzeTrace(trace: Trace, opts: AnalyzeOptions = {}): { json: ObservationJson; findings: Finding[] } {
  const frames = trace.times.length;
  const t0 = trace.times[0] ?? 0;
  const ctx: Context = {
    trace,
    fps: trace.fps,
    bpm: trace.bpm,
    times: trace.times.map(t => t - t0),
    handle: trace.handle,
    // Live frame timing jitters; a known speed clock decides beat locks.
    jitter: trace.mode === 'live',
    ...(trace.clock ? { clock: trace.clock } : {}),
  };
  const intensityOf = (comps: Float64Array[]) => intensitySeries(comps, trace.signature);
  const prepared: Prepared[] = trace.samples.map((sample, i) => ({
    sample,
    signal: makeSignal(splitComponents(trace.values[i] ?? new Float32Array(0), trace.arity, frames), intensityOf),
    index: i,
  }));
  // One onset level for every head: the mid level of all samples.
  const level = onsetLevel(prepared.map(p => p.signal));
  for (const p of prepared) {
    const h = headFeatures(p.signal, level, ctx.times);
    if (h.onset !== undefined) p.onset = h.onset;
  }

  // Fixtures (heads merged).
  const fixtureMap = byFixture(prepared);
  const fixtures: Record<string, FixtureFeatures> = {};
  const merged = new Map<string, { signal: Signal; name: string }>();
  for (const [id, heads] of fixtureMap) {
    const signal = fixtureSignal(heads, trace);
    merged.set(id, { signal, name: heads[0]!.sample.fixtureName });
    fixtures[id] = fixtureFeatures(heads, signal, ctx, level);
  }

  const json: ObservationJson = {
    window: { from: round4(trace.fromS), duration: round4(trace.durationS), fps: trace.fps, frames, mode: trace.mode, bpm: round4(trace.bpm) },
    signature: trace.signature,
    sources: sourcesOf(trace),
    group: groupFeatures(prepared, ctx),
    fixtures,
  };

  // Requested groups: features over the samples of their fixtures only.
  if (opts.groups && opts.groups.length > 0) {
    const groups: Record<string, GroupFeatures> = {};
    for (const g of opts.groups) {
      const ids = new Set(g.fixtureIds.map(String));
      groups[String(g.id)] = { name: g.name, ...groupFeatures(prepared.filter(p => ids.has(String(p.sample.fixtureId))), ctx) };
    }
    json.groups = groups;
  }

  if (opts.detail === 'raw') {
    const raw: Record<string, number[][]> = {};
    const rawHeads: Record<string, number[][][]> = {};
    const series = (sig: Signal) => Array.from({ length: frames }, (_, fr) => sig.comps.map(c => round4(c[fr]!)));
    for (const [id, f] of merged) raw[id] = series(f.signal);
    for (const [id, heads] of fixtureMap) {
      rawHeads[id] = [...heads].sort((a, b) => a.sample.head - b.sample.head).map(h => series(h.signal));
    }
    json.raw = { times: Array.from(ctx.times, round4), fixtures: raw, heads: rawHeads };
  }

  return { json: reorder(json), findings: collectFindings(trace, prepared, merged) };
}

/** Puts the JSON keys in the documented order (groups before fixtures). */
function reorder(json: ObservationJson): ObservationJson {
  return {
    window: json.window,
    signature: json.signature,
    sources: json.sources,
    group: json.group,
    ...(json.groups ? { groups: json.groups } : {}),
    fixtures: json.fixtures,
    ...(json.raw ? { raw: json.raw } : {}),
  };
}
