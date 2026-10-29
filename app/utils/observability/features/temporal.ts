/**
 * `temporal` feature (ADR 0002 §6.3): constant / periodic / events /
 * aperiodic verdict of one or several signals.
 *
 * - periodic: mean normalized autocorrelation over the signals (phase
 *   offsets between fixtures do not cancel), first strong peak after the
 *   first zero crossing, refined parabolically, validated by phase folding;
 * - events: binary-ish intensity with few threshold crossings;
 * - aperiodic: band holding the central 80 % of the spectral energy.
 */
import type { Temporal } from './types';
import type { Signal } from './signal';
import { round4 } from './signal';

// ── Context / thresholds ────────────────────────

/** Timing context of an analysis. */
export interface TemporalContext {
  fps: number;
  bpm: number;
  /** Frame times relative to the window start (s). */
  times: Float64Array;
}

/** Autocorrelation peak threshold (lags ≤ N/2, beyond). */
const PEAK_MIN = 0.5;
const PEAK_MIN_LATE = 0.6;
/** Minimum share of variance explained by the folded period profile. */
const FOLD_MIN = 0.5;
/** Beat multiples checked for beat lock. */
const BEAT_MULTIPLES = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16];
/** Maximum number of crossings of an `events` signal. */
const MAX_EVENTS = 12;

// ── Autocorrelation ─────────────────────────────

/**
 * Unbiased normalized autocorrelation `r[0..maxLag]` of a multivariate
 * signal: sum over components of centered products, divided by the number
 * of overlapping frames, relative to the lag-0 variance.
 */
export function autocorrelation(sig: Signal, maxLag: number): Float64Array {
  const n = sig.frames;
  const r = new Float64Array(maxLag + 1);
  const v0 = sig.energy / Math.max(1, n);
  if (v0 <= 1e-12) return r;
  for (let k = 0; k <= maxLag; k++) {
    let s = 0;
    for (const x of sig.centered) for (let t = 0; t + k < n; t++) s += x[t]! * x[t + k]!;
    r[k] = s / (n - k) / v0;
  }
  return r;
}

/** Period (frames, fractional) and strength from an autocorrelation; null when none. */
export function findPeriodLag(ac: Float64Array, frames: number): { lag: number; strength: number } | null {
  const maxLag = ac.length - 1;
  // First zero crossing: the period peak must come after it.
  let z = -1;
  for (let k = 1; k <= maxLag; k++) {
    if (ac[k]! <= 0) {
      z = k;
      break;
    }
  }
  if (z < 0) return null;
  const peaks: number[] = [];
  for (let k = z + 1; k < maxLag; k++) {
    const v = ac[k]!;
    const min = k <= frames / 2 ? PEAK_MIN : PEAK_MIN_LATE;
    if (v > min && v >= ac[k - 1]! && v >= ac[k + 1]!) peaks.push(k);
  }
  if (peaks.length === 0) return null;
  // First peak close to the strongest one (avoids picking a multiple).
  const best = Math.max(...peaks.map(k => ac[k]!));
  const k = peaks.find(p => ac[p]! >= 0.9 * best)!;
  const y0 = ac[k - 1]!;
  const y1 = ac[k]!;
  const y2 = ac[k + 1]!;
  const denom = y0 - 2 * y1 + y2;
  const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  const strength = y1 - 0.25 * (y0 - y2) * delta;
  return { lag: k + delta, strength: Math.max(0, Math.min(1, strength)) };
}

/** Share of variance explained by the mean profile folded at `lag` frames. */
export function foldingRatio(sig: Signal, lag: number): number {
  if (sig.energy <= 1e-12) return 0;
  const bins = Math.max(3, Math.min(16, Math.round(lag / 1.5)));
  let between = 0;
  for (const x of sig.centered) {
    const sum = new Float64Array(bins);
    const cnt = new Float64Array(bins);
    for (let t = 0; t < x.length; t++) {
      const phase = (t % lag) / lag;
      const b = Math.min(bins - 1, Math.floor(phase * bins));
      sum[b]! += x[t]!;
      cnt[b]! += 1;
    }
    for (let b = 0; b < bins; b++) if (cnt[b]! > 0) between += (sum[b]! * sum[b]!) / cnt[b]!;
  }
  return between / sig.energy;
}

// ── Frequency refinement ────────────────────────

/**
 * Power explained by a least-squares sinusoid of frequency `hz` (with
 * offset), summed over signals and components. Unlike a plain DFT this is
 * exact for windows with a non-integer number of cycles.
 */
function sinePower(signals: Signal[], hz: number, fps: number): number {
  const n = signals[0]?.frames ?? 0;
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  let mc = 0;
  let ms = 0;
  for (let t = 0; t < n; t++) {
    cos[t] = Math.cos((2 * Math.PI * hz * t) / fps);
    sin[t] = Math.sin((2 * Math.PI * hz * t) / fps);
    mc += cos[t]! / n;
    ms += sin[t]! / n;
  }
  // Centered basis (equivalent to fitting a constant term too).
  let scc = 0;
  let sss = 0;
  let scs = 0;
  for (let t = 0; t < n; t++) {
    cos[t]! -= mc;
    sin[t]! -= ms;
    scc += cos[t]! * cos[t]!;
    sss += sin[t]! * sin[t]!;
    scs += cos[t]! * sin[t]!;
  }
  const det = scc * sss - scs * scs;
  if (det <= 1e-12) return 0;
  let power = 0;
  for (const s of signals) {
    for (const x of s.centered) {
      let sxc = 0;
      let sxs = 0;
      for (let t = 0; t < n; t++) {
        sxc += x[t]! * cos[t]!;
        sxs += x[t]! * sin[t]!;
      }
      const a = (sxc * sss - sxs * scs) / det;
      const b = (sxs * scc - sxc * scs) / det;
      power += a * sxc + b * sxs;
    }
  }
  return power;
}

/**
 * Refines a frequency estimate (±10 %) by maximizing the least-squares
 * sine power. Only applied to near-sinusoidal signals (the fit explains
 * ≥ 90 % of the variance): harmonics of square / saw waves bias the
 * fundamental's fit, so those keep the autocorrelation estimate.
 */
export function refineFrequency(signals: Signal[], hz: number, fps: number): number {
  const steps = 40;
  const lo = hz * 0.9;
  const dh = (hz * 0.2) / steps;
  const p = Array.from({ length: steps + 1 }, (_, i) => sinePower(signals, lo + i * dh, fps));
  let k = 0;
  for (let i = 1; i <= steps; i++) if (p[i]! > p[k]!) k = i;
  // Peak at the border: keep the autocorrelation estimate.
  if (k === 0 || k === steps) return hz;
  const y0 = p[k - 1]!;
  const y1 = p[k]!;
  const y2 = p[k + 1]!;
  const denom = y0 - 2 * y1 + y2;
  const delta = denom < 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const total = signals.reduce((acc, s) => acc + s.energy, 0);
  if (total <= 0 || y1 / total < 0.9) return hz;
  return lo + (k + delta) * dh;
}

// ── Spectrum ────────────────────────────────────

/** Power spectrum (bins 0..N/2) of a multivariate signal, summed over components. */
export function powerSpectrum(sig: Signal): Float64Array {
  const n = sig.frames;
  const half = Math.floor(n / 2);
  const p = new Float64Array(half + 1);
  // Twiddle table: cos/sin(2π·j/n), indexed by (k·t) mod n.
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    cos[j] = Math.cos((2 * Math.PI * j) / n);
    sin[j] = Math.sin((2 * Math.PI * j) / n);
  }
  for (const x of sig.centered) {
    for (let k = 1; k <= half; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0, j = 0; t < n; t++, j = (j + k) % n) {
        re += x[t]! * cos[j]!;
        im -= x[t]! * sin[j]!;
      }
      p[k]! += re * re + im * im;
    }
  }
  return p;
}

/** Frequency band (Hz) holding the central 80 % of the energy of a spectrum. */
function energyBand(p: Float64Array, frames: number, fps: number): [number, number] {
  let total = 0;
  for (let k = 1; k < p.length; k++) total += p[k]!;
  if (total <= 0) return [0, 0];
  let acc = 0;
  let lo = 0;
  let hi = 0;
  for (let k = 1; k < p.length; k++) {
    const prev = acc;
    acc += p[k]!;
    if (prev < 0.1 * total && acc >= 0.1 * total) lo = k;
    if (prev < 0.9 * total && acc >= 0.9 * total) hi = k;
  }
  const hz = (k: number) => round4((k * fps) / frames);
  return [hz(lo), hz(hi)];
}

// ── Events ──────────────────────────────────────

/** On/off times (s) of a binary-ish series; null when not binary or too busy. */
export function detectEvents(series: Float64Array, times: Float64Array): { on: number[]; off: number[] } | null {
  const n = series.length;
  if (n < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, series[i]!);
    max = Math.max(max, series[i]!);
  }
  if (max - min < 0.1) return null;
  let near = 0;
  for (let i = 0; i < n; i++) if (series[i]! - min <= 0.05 || max - series[i]! <= 0.05) near++;
  if (near / n < 0.9) return null;
  const mid = (min + max) / 2;
  const on: number[] = [];
  const off: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if ((a < mid) === (b < mid)) continue;
    // Linear interpolation of the crossing time.
    const u = (mid - a) / (b - a);
    const t = round4(times[i - 1]! + u * (times[i]! - times[i - 1]!));
    (b > a ? on : off).push(t);
  }
  if (on.length + off.length === 0 || on.length + off.length > MAX_EVENTS) return null;
  return { on, off };
}

// ── Verdict ─────────────────────────────────────

/** Builds the periodic verdict for a frequency. */
function periodic(hz: number, strength: number, ctx: TemporalContext): Temporal {
  const period = 1 / hz;
  const beats = ctx.bpm > 0 ? (period * ctx.bpm) / 60 : 0;
  const beatLock = beats > 0 && BEAT_MULTIPLES.some(m => Math.abs(beats / m - 1) <= 0.03);
  return {
    kind: 'periodic',
    hz: round4(1 / period),
    period: round4(period),
    beats: round4(beats),
    beatLock,
    strength: round4(strength),
  };
}

/**
 * Group-level temporal verdict of several signals (one signal = a single
 * series). Constant signals are ignored unless all are constant.
 */
export function analyzeTemporal(signals: Signal[], ctx: TemporalContext): Temporal {
  const active = signals.filter(s => !s.constant);
  const first = active[0];
  if (!first) return { kind: 'constant' };
  const frames = first.frames;
  // Periodicity on the mean autocorrelation.
  if (frames >= 8) {
    const maxLag = Math.floor(0.75 * frames);
    const meanAc = new Float64Array(maxLag + 1);
    for (const s of active) {
      const ac = autocorrelation(s, maxLag);
      for (let k = 0; k <= maxLag; k++) meanAc[k]! += ac[k]! / active.length;
    }
    const peak = findPeriodLag(meanAc, frames);
    if (peak) {
      let fold = 0;
      for (const s of active) fold += foldingRatio(s, peak.lag) / active.length;
      if (fold >= FOLD_MIN) return periodic(refineFrequency(active, ctx.fps / peak.lag, ctx.fps), peak.strength, ctx);
    }
  }
  // Events on the mean intensity.
  const meanIntensity = new Float64Array(frames);
  for (const s of active) for (let f = 0; f < frames; f++) meanIntensity[f]! += s.intensity[f]! / active.length;
  const events = detectEvents(meanIntensity, ctx.times);
  if (events) return { kind: 'events', ...events };
  // Aperiodic: band of the mean spectrum.
  const spec = new Float64Array(Math.floor(frames / 2) + 1);
  for (const s of active) {
    const p = powerSpectrum(s);
    for (let k = 0; k < spec.length; k++) spec[k]! += p[k]! / active.length;
  }
  return { kind: 'aperiodic', band: energyBand(spec, frames, ctx.fps) };
}
