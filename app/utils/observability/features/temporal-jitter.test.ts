// @vitest-environment node
/**
 * Live group temporal under capture jitter (WP-M item 3): frames of a live
 * capture arrive at irregular times; the group verdict must still find the
 * common period every fixture shares (scenario 1: a 0.5 Hz runner read as
 * `aperiodic` while every fixture was periodic).
 */
import { describe, expect, it } from 'vitest';
import { frameTimes, resampleTuples } from '../capture';
import type { Trace, TraceSample } from '../types';
import { analyzeTrace } from './index';
import { seededRandom } from './test-traces';

// ── Helpers ─────────────────────────────────────

/** Narrow runner pulse (0–1) of fixture `i` of `n` at time `t` (period `period` s). */
function runner(i: number, n: number, t: number, period: number): number {
  let d = (((t / period - i / n) % 1) + 1) % 1;
  d = Math.min(d, 1 - d);
  return Math.exp(-(d * d) / (2 * 0.06 * 0.06));
}

/**
 * A live trace of `n` fixtures captured from frames at irregular times:
 * 60 fps ± 4 ms render jitter, delivered in bursts of up to `burst` frames
 * that arrive up to `delay` s late. `useEngineTime` places frames on the
 * render times (as the capture does with `LiveFrame.timeMs`); otherwise
 * the bursty arrival times are used (the wall-clock fallback).
 */
function jitteredTrace(n: number, duration: number, burst: number, delay: number, useEngineTime: boolean, seed = 7): Trace {
  const jitterMs = 4;
  const rnd = seededRandom(seed);
  const recorded: Array<{ wall: number; engine: number; tuples: number[][] }> = [];
  let render = 0;
  let pending: number[] = [];
  while (render < duration + 0.1) {
    render += (1000 / 60 + (rnd() * 2 - 1) * jitterMs) / 1000;
    pending.push(render);
    // Bursty delivery: the main thread receives 1–`burst` frames at once.
    if (pending.length >= 1 + Math.floor(rnd() * burst)) {
      const arrival = render + rnd() * delay;
      for (const t of pending) recorded.push({ wall: arrival, engine: t, tuples: [Array.from({ length: n }, (_, i) => runner(i, n, t, 2))] });
      pending = [];
    }
  }
  const timeline = frameTimes(useEngineTime ? recorded : recorded.map(r => ({ ...r, engine: Number.NaN })));
  const fps = 30;
  const frames = Math.round(duration * fps);
  const perSample = resampleTuples(timeline.times, recorded.map(r => r.tuples[0]!.map(v => [v])), n, 1, frames, fps);
  const samples: TraceSample[] = Array.from({ length: n }, (_, i) => ({
    fixtureId: `f${i}`, fixtureName: `f${i}`, head: 0, headCount: 1, x: i / (n - 1), y: 0.5, z: 0, groupIds: [],
  }));
  return {
    mode: 'live', signature: 'scalar', arity: 1, fps, fromS: 0, durationS: duration, bpm: 120,
    times: Float64Array.from({ length: frames }, (_, f) => f / fps), samples, values: perSample,
  };
}

// ── Tests ───────────────────────────────────────

describe('temporal: live capture jitter', () => {
  it('prefers the engine timeline and falls back to the wall clock', () => {
    const rec = [{ wall: 0, engine: 10 }, { wall: 0.05, engine: 10.0167 }, { wall: 0.05, engine: 10.0333 }];
    expect(frameTimes(rec).source).toBe('engine');
    // Engine clock reset mid-capture → wall clock.
    expect(frameTimes([{ wall: 0, engine: 10 }, { wall: 0.1, engine: 0 }]).source).toBe('wall');
  });

  // Engine timeline: robust to heavy bursts (up to 15 frames, 200 ms late).
  // Wall-clock fallback: robust to moderate bursts (10 frames, 100 ms).
  // 4 s windows hold only two periods: own-period estimates near half the
  // window are off by ~2 frames, which used to break the group verdict.
  it.each([
    ['engine timeline', true, 15, 0.2],
    ['engine timeline', true, 3, 0.02],
    ['wall-clock fallback', false, 10, 0.1],
    ['wall-clock fallback', false, 3, 0.02],
  ])('a 0.5 Hz runner stays periodic at 0.5 Hz on the group (%s, bursts ≤ %i, ≤ %fs late)', (_, engine, burst, delay) => {
    for (const n of [12, 48]) {
      for (const duration of [4, 6, 8]) {
        const { json } = analyzeTrace(jitteredTrace(n, duration, burst, delay, engine));
        for (const f of Object.values(json.fixtures)) expect(f.temporal.kind).toBe('periodic');
        const tmp = json.group.temporal;
        expect(tmp.kind, `${n} fixtures, ${duration}s: ${JSON.stringify(tmp)}`).toBe('periodic');
        if (tmp.kind === 'periodic') expect(Math.abs(tmp.hz - 0.5), `${n} fixtures, ${duration}s`).toBeLessThan(0.01);
      }
    }
  });

  it('keeps unrelated periods (1 Hz and 1.37 Hz) non-periodic in a live trace', () => {
    const trace = jitteredTrace(8, 6, 3, 0.02, true);
    // Replace the values: half the fixtures at 1 Hz, half at 1.37 Hz.
    trace.values = trace.values.map((v, i) => Float32Array.from(v, (_, f) => 0.5 + 0.5 * Math.sin(2 * Math.PI * ((i % 2 ? 1.37 : 1) * f / trace.fps - i / 8))));
    expect(analyzeTrace(trace).json.group.temporal.kind).not.toBe('periodic');
  });
});
