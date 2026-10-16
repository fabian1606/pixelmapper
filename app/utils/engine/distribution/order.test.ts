// @vitest-environment node
/**
 * Rank resolution (plan M3.2) and selection analysis (plan M3.3).
 */
import { describe, expect, it } from 'vitest';
import { clickRank, projectionRanks, resolveRanks } from './order';
import { analyzeSelection } from './selection-shape';

/** Deterministic pseudo-random in [−1, 1]. */
const jitter = (i: number) => Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 78.233) * 0.5;

const row = (n: number, y = 0.5) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, x: 0.1 + i * 0.1, y }));
/** Symmetric double row: two columns (left/right) of `n` front → back. */
const doubleRow = (n: number) => Array.from({ length: n }, (_, i) => [
  { id: `l${i}`, x: 0.3, y: 0.1 + i * 0.1 },
  { id: `r${i}`, x: 0.7, y: 0.1 + i * 0.1 },
]).flat();

describe('projectionRanks / resolveRanks', () => {
  it('8 in a row → 0..7', () => {
    const r = projectionRanks(row(8), { x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 0.5);
    expect(row(8).map(f => r[f.id])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('symmetric double row, line front → back: pairs share ranks', () => {
    const r = projectionRanks(doubleRow(6), { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, 0.5);
    for (let i = 0; i < 6; i++) {
      expect(r[`l${i}`]).toBe(i);
      expect(r[`r${i}`]).toBe(i);
    }
  });

  it('jitter of 20 % of the spacing keeps the ranks (snap 0.5)', () => {
    const pts = row(8).map((f, i) => ({ ...f, x: f.x + jitter(i) * 0.02, y: f.y + jitter(i + 9) * 0.02 }));
    const r = projectionRanks(pts, { x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 0.5);
    expect(pts.map(f => r[f.id])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('snap 0 → all distinct', () => {
    const pts = doubleRow(3).map((f, i) => ({ ...f, y: f.y + i * 1e-3 }));
    const r = projectionRanks(pts, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, 0);
    expect(new Set(Object.values(r)).size).toBe(6);
  });

  it('single fixture → rank 0', () => {
    expect(resolveRanks({ order: { ranks: {}, snap: 0.5 } }, [{ id: 1, x: 0.5, y: 0.5 }])).toEqual({ ranks: { 1: 0 }, rankCount: 1 });
  });

  it('mirror ranks by the distance from line.a (center out)', () => {
    const r = projectionRanks(row(5), { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.5, true);
    expect(row(5).map(f => r[f.id])).toEqual([2, 1, 0, 1, 2]);
  });

  it('without a line, the selection axis orders the fixtures', () => {
    expect(resolveRanks({ order: { ranks: {}, snap: 0.5 } }, row(4).reverse())).toEqual({ ranks: { f0: 0, f1: 1, f2: 2, f3: 3 }, rankCount: 4 });
  });

  it('explicit ranks win; others join matching clusters or are appended, then compacted', () => {
    const fixtures = doubleRow(3);
    const r = resolveRanks({ order: { ranks: { l0: 5, l2: 9 }, line: { a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } }, snap: 0.5 } }, fixtures);
    expect(r.ranks).toMatchObject({ l0: 0, r0: 0, l2: 1, r2: 1, l1: 2, r1: 2 });
    expect(r.rankCount).toBe(3);
  });
});

describe('clickRank', () => {
  it('assigns increasing ranks, shift shares, re-click moves', () => {
    let s = clickRank({}, 'a', false, null);
    s = clickRank(s.ranks, 'b', false, s.last);
    s = clickRank(s.ranks, 'c', true, s.last);
    s = clickRank(s.ranks, 'a', false, s.last);
    expect(s.ranks).toEqual({ a: 2, b: 1, c: 1 });
  });
});

describe('analyzeSelection', () => {
  it('row', () => {
    const s = analyzeSelection(row(8));
    expect(s.kind).toBe('row');
    expect(s.axis.a.x).toBeCloseTo(0.1);
    expect(s.axis.b.x).toBeCloseTo(0.8);
  });

  it('ring', () => {
    const ring = Array.from({ length: 12 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i * Math.PI / 6), y: 0.5 + 0.3 * Math.sin(i * Math.PI / 6) }));
    const s = analyzeSelection(ring);
    expect(s.kind).toBe('ring');
    expect(s.radius).toBeCloseTo(0.3);
  });

  it('area', () => {
    const grid = Array.from({ length: 9 }, (_, i) => ({ x: 0.2 + (i % 3) * 0.2, y: 0.2 + Math.floor(i / 3) * 0.15 }));
    expect(analyzeSelection(grid).kind).toBe('area');
  });

  it('single', () => {
    expect(analyzeSelection([{ x: 0.5, y: 0.5 }]).kind).toBe('single');
  });

  it('bars (multi-head)', () => {
    const bars = Array.from({ length: 4 }, (_, i) => ({ x: 0.2 + i * 0.2, y: 0.5, heads: 16 }));
    const s = analyzeSelection(bars);
    expect(s.multiHead).toBe(true);
    expect(analyzeSelection([...bars, { x: 0.9, y: 0.5, heads: 1 }]).multiHead).toBe(false);
  });

  it('vertical axis is oriented +y', () => {
    const col = Array.from({ length: 5 }, (_, i) => ({ x: 0.5, y: 0.8 - i * 0.1 }));
    const s = analyzeSelection(col);
    expect(s.axis.b.y).toBeGreaterThan(s.axis.a.y);
  });
});

describe('plan R1: robust pairs and center-out detection', () => {
  it('roughly symmetric pairs share a number (jittered double row)', () => {
    const rig = Array.from({ length: 6 }, (_, i) => [
      { id: `l${i}`, x: 0.3, y: 0.1 + i * 0.1 + Math.abs(jitter(i)) * 0.03 },
      { id: `r${i}`, x: 0.7, y: 0.1 + i * 0.1 },
    ]).flat();
    const r = projectionRanks(rig, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, 0.5);
    for (let i = 0; i < 6; i++) expect(r[`l${i}`]).toBe(r[`r${i}`]);
  });

  it('a line starting inside the rig is detected; one starting at an end is not', async () => {
    const { lineStartsInside } = await import('./order');
    expect(lineStartsInside(row(8), { x: 0.45, y: 0.5 }, { x: 0.9, y: 0.5 })).toBe(true);
    expect(lineStartsInside(row(8), { x: 0.05, y: 0.5 }, { x: 0.9, y: 0.5 })).toBe(false);
  });
});
