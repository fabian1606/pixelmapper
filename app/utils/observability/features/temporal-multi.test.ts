// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from './index';
import { makeTrace, seededRandom, sine01 } from './test-traces';

// ── Helpers ─────────────────────────────────────

/**
 * Gaussian pulse (0–1) seen at loop position `at` from a point at loop
 * position `pos` (both in loop turns; distance wraps around the loop).
 */
function loopPulse(pos: number, at: number, width: number): number {
  let d = (((pos - at) % 1) + 1) % 1;
  d = Math.min(d, 1 - d);
  return Math.exp(-(d * d) / (2 * width * width));
}

/**
 * Two points chasing around a loop of `n` fixtures at 120 bpm: point A
 * takes 8 beats (4 s) per lap; every `harmonicEvery`-th fixture also sees
 * point B, which laps in 4 beats (2 s). Narrow pulses defeat the phase
 * folding of the joint analysis, so only the common period finds 8 beats.
 */
function chaseTrace(n: number, duration: number, width: number, harmonicEvery: number) {
  return makeTrace({
    samples: n,
    duration,
    bpm: 120,
    fn: (i, t) => {
      const at = i / n;
      const a = loopPulse(t / 4, at, width);
      if (i % harmonicEvery !== 0) return [a];
      // 4-beat component dominates, the 8-beat point is dimmer.
      return [Math.min(1, 0.5 * a + loopPulse(t / 2 + 0.3, at, width))];
    },
  });
}

// ── Common period ───────────────────────────────

describe('temporal: common period of several signals', () => {
  it.each([
    ['10 s, every 3rd fixture with a 4-beat point', 10, 0.01, 3],
    ['8 s, every 2nd fixture with a 4-beat point', 8, 0.01, 2],
    ['10 s, very narrow pulses', 10, 0.005, 2],
  ])('finds 8 beats with beat lock for phase-shifted pulses (%s)', (_, duration, width, every) => {
    const { json } = analyzeTrace(chaseTrace(12, duration, width, every));
    const tmp = json.group.temporal;
    expect(tmp.kind).toBe('periodic');
    if (tmp.kind !== 'periodic') return;
    expect(tmp.beats).toBeCloseTo(8, 1);
    expect(tmp.period).toBeCloseTo(4, 1);
    expect(tmp.beatLock).toBe(true);
    expect(tmp.strength).toBeGreaterThan(0.8);
  });

  it.each([1, 2, 3])('keeps seeded noise aperiodic over 10 s (seed set %i)', seed => {
    const rngs = Array.from({ length: 12 }, (_, i) => seededRandom(seed * 100 + i));
    const { json } = analyzeTrace(makeTrace({ samples: 12, duration: 10, fn: i => [rngs[i]!()] }));
    expect(json.group.temporal.kind).toBe('aperiodic');
  });

  it.each([2, 10])('does not force unrelated periods (1 Hz and 1.37 Hz, %i s) to periodic', duration => {
    const { json } = analyzeTrace(makeTrace({
      samples: 8,
      duration,
      fn: (i, t) => [i % 2 === 0 ? sine01(t, 1, i / 8) : sine01(t, 1.37, i / 8)],
    }));
    expect(json.group.temporal.kind).not.toBe('periodic');
  });

  it('does not force sparse unrelated pulse trains (4 s and 2.9 s) to periodic', () => {
    const { json } = analyzeTrace(makeTrace({
      samples: 8,
      duration: 10,
      fn: (i, t) => [i % 2 === 0 ? loopPulse(t / 4, i / 8, 0.01) : loopPulse(t / 2.9, i / 8, 0.01)],
    }));
    expect(json.group.temporal.kind).not.toBe('periodic');
  });
});
