// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeTrace } from './index';
import { makeTrace, seededRandom, sine01 } from './test-traces';

// ── Temporal ────────────────────────────────────

describe('temporal features', () => {
  it('detects a 1 Hz sine over 2 s at 30 fps as periodic', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 4, fn: (_, t) => [sine01(t, 1)] }));
    const tmp = json.group.temporal;
    expect(tmp.kind).toBe('periodic');
    if (tmp.kind !== 'periodic') return;
    expect(tmp.hz).toBeGreaterThan(0.98);
    expect(tmp.hz).toBeLessThan(1.02);
    // 1 s at 120 bpm = 2 beats → beat lock.
    expect(tmp.beats).toBeCloseTo(2, 1);
    expect(tmp.beatLock).toBe(true);
    expect(json.fixtures['1']?.temporal.kind).toBe('periodic');
    expect(json.group.components.value?.temporal.kind).toBe('periodic');
  });

  it.each([
    ['sine 2 Hz', 2, (t: number) => sine01(t, 2)],
    ['sine 0.75 Hz', 0.75, (t: number) => sine01(t, 0.75)],
    ['square 1 Hz', 1, (t: number) => ((t * 1) % 1 < 0.5 ? 1 : 0)],
    ['saw 2 Hz', 2, (t: number) => (t * 2) % 1],
  ])('detects %s', (_, hz, wave) => {
    const { json } = analyzeTrace(makeTrace({ samples: 3, fn: (_i, t) => [wave(t)] }));
    const tmp = json.group.temporal;
    expect(tmp.kind).toBe('periodic');
    if (tmp.kind === 'periodic') expect(Math.abs(tmp.hz - hz) / hz).toBeLessThan(0.03);
  });

  it('reports seeded noise as aperiodic and spatially independent', () => {
    const rngs = Array.from({ length: 8 }, (_, i) => seededRandom(1000 + i));
    const { json } = analyzeTrace(makeTrace({ samples: 8, fn: i => [rngs[i]!()] }));
    expect(json.group.temporal.kind).toBe('aperiodic');
    if (json.group.temporal.kind === 'aperiodic') expect(json.group.temporal.band[1]).toBeGreaterThan(json.group.temporal.band[0]);
    expect(json.group.spatial.kind).toBe('independent');
    if (json.group.spatial.kind === 'independent') expect(Math.abs(json.group.spatial.corr)).toBeLessThan(0.3);
  });

  it('reports a single on/off switch as events', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 2, fn: (_, t) => [t >= 0.5 && t < 1.2 ? 1 : 0] }));
    const tmp = json.group.temporal;
    expect(tmp.kind).toBe('events');
    if (tmp.kind !== 'events') return;
    expect(tmp.on).toHaveLength(1);
    expect(tmp.off).toHaveLength(1);
    expect(tmp.on[0]).toBeCloseTo(0.5, 1);
    expect(tmp.off[0]).toBeCloseTo(1.2, 1);
  });
});

// ── Spatial ─────────────────────────────────────

describe('spatial features', () => {
  it('detects a chase along +x with phase step 1/8', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 8, fn: (i, t) => [sine01(t, 1, i / 8)] }));
    const sp = json.group.spatial;
    expect(sp.kind).toBe('chase');
    if (sp.kind !== 'chase') return;
    expect(sp.axis).toBe('position');
    expect(sp.step).toBeGreaterThan(0.115);
    expect(sp.step).toBeLessThan(0.135);
    expect(sp.direction[0]).toBeGreaterThan(0.95);
    // 7/8 cycle over 1 world unit at 1 Hz → 1/0.875 u/s.
    expect(sp.speed).toBeCloseTo(1 / 0.875, 1);
  });

  it('reports a chase along the spread when it fits better than positions (B6)', () => {
    const order = [3, 0, 6, 1, 5, 2, 7, 4];
    const trace = makeTrace({
      samples: order.map(k => ({ spatial: k / 7 })),
      fn: (i, t) => [sine01(t, 1, order[i]! / 8)],
    });
    const sp = analyzeTrace(trace).json.group.spatial;
    expect(sp.kind).toBe('chase');
    if (sp.kind === 'chase') {
      expect(sp.axis).toBe('spread');
      expect(sp.step).toBeCloseTo(0.125, 2);
    }
  });

  it('reports identical samples as uniform', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 5, fn: (_, t) => [sine01(t, 1)] }));
    expect(json.group.spatial.kind).toBe('uniform');
    expect(json.group.symmetry?.corr).toBe(1);
  });

  it('reports a static ramp across x as gradient', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 6, fn: i => [i / 5] }));
    const sp = json.group.spatial;
    expect(json.group.temporal.kind).toBe('constant');
    expect(sp.kind).toBe('gradient');
    if (sp.kind === 'gradient') {
      expect(sp.direction[0]).toBeGreaterThan(0.95);
      expect(sp.span).toBeCloseTo(1, 2);
    }
  });

  it('detects outward radial propagation from 4 points', () => {
    const points = [
      { key: 'p0', x: 0.25, y: 0.25 },
      { key: 'p1', x: 0.75, y: 0.25 },
      { key: 'p2', x: 0.25, y: 0.75 },
      { key: 'p3', x: 0.75, y: 0.75 },
    ];
    const grid = Array.from({ length: 64 }, (_, i) => ({ x: (i % 8) / 7, y: Math.floor(i / 8) / 7 }));
    const dist = (i: number) => Math.min(...points.map(p => Math.hypot(grid[i]!.x - p.x, grid[i]!.y - p.y)));
    // Pulse traveling outward at 1 u/s with 1 s period.
    const pulse = (u: number) => Math.exp(-(((u - Math.floor(u)) - 0.5) ** 2) / 0.02);
    const trace = makeTrace({ samples: grid, points, fn: (i, t) => [pulse(t * 1 - dist(i))] });
    const start = performance.now();
    const { json } = analyzeTrace(trace);
    const elapsed = performance.now() - start;
    expect(json.group.radial?.r).toBeGreaterThan(0.9);
    expect(json.group.radial?.kind).toBe('outward');
    expect(json.group.radial?.speed).toBeCloseTo(1, 1);
    // 64 samples × 60 frames must analyze well under 100 ms.
    expect(elapsed).toBeLessThan(100);
  });
});

// ── Color ───────────────────────────────────────

describe('color features', () => {
  it('names a pulsing orange and keeps the hue arc tight', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 3, signature: 'rgb', fn: (_, t) => {
      const v = 0.2 + 0.8 * sine01(t, 1);
      return [v, v * 0.5, 0];
    } }));
    expect(json.group.color?.name).toBe('orange');
    expect(json.group.color?.hue.mean).toBeCloseTo(30, 0);
    expect(json.group.color?.sat.mean).toBeCloseTo(1, 2);
    expect(Object.keys(json.group.components)).toEqual(['r', 'g', 'b']);
  });

  it('reports a rainbow as mixed', () => {
    const { json } = analyzeTrace(makeTrace({ samples: 2, signature: 'rgb', fn: (_, t) => [sine01(t, 1), sine01(t, 1, 1 / 3), sine01(t, 1, 2 / 3)] }));
    expect(json.group.color?.name).toBe('mixed');
    expect(json.group.temporal.kind).toBe('periodic');
  });
});

// ── Issues / findings ───────────────────────────

describe('issues and findings', () => {
  it('flags a constant output', () => {
    const { json, findings } = analyzeTrace(makeTrace({ samples: 4, fn: () => [0.5] }));
    expect(json.group.temporal.kind).toBe('constant');
    expect(json.group.spatial.kind).toBe('constant');
    expect(json.group.issues).toContain('constant');
    expect(json.group.active).toBe(0);
    expect(findings.map(f => f.code)).toContain('observe-constant-output');
  });

  it('handles zero samples without crashing', () => {
    const { json, findings } = analyzeTrace(makeTrace({ samples: 0, fn: () => [0] }));
    const f = findings.find(x => x.code === 'observe-zero-targets');
    expect(f?.level).toBe('warning');
    expect(json.group.count).toBe(0);
    expect(json.group.issues).toContain('no-targets');
    expect(json.fixtures).toEqual({});
  });

  it('detects stuck-0, stuck-1 and clamped fixtures', () => {
    const fn = (i: number, t: number) => {
      if (i === 0) return [0];
      if (i === 1) return [1];
      return [Math.max(0, Math.min(1, 0.5 + 0.9 * Math.sin(2 * Math.PI * t)))];
    };
    const { json, findings } = analyzeTrace(makeTrace({ samples: 3, fn }));
    expect(json.fixtures['1']?.issues).toEqual(['constant', 'stuck-0']);
    expect(json.fixtures['2']?.issues).toEqual(['constant', 'stuck-1']);
    expect(json.fixtures['3']?.issues).toEqual(['clamped']);
    expect(json.group.issues).toEqual(['stuck-0', 'stuck-1', 'clamped']);
    const stuck = findings.find(f => f.code === 'observe-stuck');
    expect(stuck?.level).toBe('warning');
    expect(stuck?.entityIds).toEqual(['fixture:1', 'fixture:2']);
  });

  it('reports NaN values and capture notes', () => {
    const trace = makeTrace({ samples: 2, notes: ['fallback used'], fn: (i, t) => [i === 0 && t > 1 ? NaN : sine01(t, 1)] });
    const { json, findings } = analyzeTrace(trace);
    expect(json.fixtures['1']?.issues).toContain('nan');
    expect(json.group.issues).toContain('nan');
    expect(findings.find(f => f.code === 'observe-unavailable-values')?.entityIds).toEqual(['fixture:1']);
    expect(findings.find(f => f.code === 'observe-note')?.message).toBe('fallback used');
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});

// ── Layout ──────────────────────────────────────

describe('json layout', () => {
  it('merges heads, analyzes requested groups and adds raw values', () => {
    const samples = [
      { fixtureId: 'a', fixtureName: 'bar-a', head: 0, headCount: 2, x: 0 },
      { fixtureId: 'a', fixtureName: 'bar-a', head: 1, headCount: 2, x: 0.2 },
      { fixtureId: 'b', fixtureName: 'par-b', x: 1 },
    ];
    const trace = makeTrace({ samples, fn: i => [i === 2 ? 0.8 : 0.2 * i] });
    const { json } = analyzeTrace(trace, { detail: 'raw', groups: [{ id: 7, name: 'bars', fixtureIds: ['a'] }] });
    expect(json.group.count).toBe(2);
    expect(json.group.samples).toBe(3);
    expect(json.fixtures.a?.heads).toBe(2);
    expect(json.fixtures.a?.x).toBe(0.1);
    expect(json.fixtures.a?.range.mean).toBe(0.1);
    expect(json.groups?.['7']?.count).toBe(1);
    expect(json.groups?.['7']?.name).toBe('bars');
    expect(json.raw?.fixtures.b?.[0]).toEqual([0.8]);
    expect(json.raw?.times).toHaveLength(60);
  });
});
