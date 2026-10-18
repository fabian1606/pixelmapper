/**
 * Preview pool (plan P3.14): renders built-in plugins on the main thread.
 * Uses the artifacts of `bun run build:plugins` (skipped when absent).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { previewRevision, releasePreview, renderCycle, renderField, renderPoints, renderStrip } from './preview-pool';
import type { PreviewPoint } from './preview-pool';

const DIR = join(__dirname, '../../../public/plugins');
const built = existsSync(DIR);

/** Waits until the pool reports a new ready instance. */
async function ready(before: number) {
  for (let i = 0; i < 100 && previewRevision.value === before; i++) await new Promise(r => setTimeout(r, 5));
}

describe.skipIf(!built)('preview pool', () => {
  beforeAll(() => {
    // Serve /plugins/<hex>.wasm from the build output.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const bytes = readFileSync(join(DIR, url.replace('/plugins/', '')));
      return new Response(bytes);
    }));
  });
  afterAll(() => vi.unstubAllGlobals());

  it('renders one waveform cycle within [0, 1]', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'] });
    const before = previewRevision.value;
    expect(renderCycle(m, 32)).toBeNull(); // first call starts loading
    await ready(before);
    const r = renderCycle(m, 32)!;
    expect(r.arity).toBe(1);
    expect(r.values.length).toBe(32);
    expect(Math.max(...r.values)).toBeLessThanOrEqual(1);
    expect(Math.min(...r.values)).toBeGreaterThanOrEqual(0);
    // A sine over one cycle is not flat.
    expect(Math.max(...r.values) - Math.min(...r.values)).toBeGreaterThan(0.5);
  });

  it('renders a field varying along the spatial direction', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'],
      distribution: { mode: 'linear', origin: { x: 0, y: 0.5 }, end: { x: 0.5, y: 0.5 } },
      params: { profile: { shape: 'wave', args: {} } },
    });
    const before = previewRevision.value;
    renderField(m, 8, 2);
    await ready(before);
    const r = renderField(m, 8, 2)!;
    expect(r.values.length).toBe(16);
    // Rows are identical for a horizontal linear direction.
    expect(Array.from(r.values.slice(0, 8))).toEqual(Array.from(r.values.slice(8, 16)));
    expect(new Set(Array.from(r.values.slice(0, 8)).map(v => v.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('renders rgb modifiers with arity 3', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.colorAdjust), { signature: 'rgb' });
    const before = previewRevision.value;
    renderCycle(m, 4);
    await ready(before);
    expect(renderCycle(m, 4)!.arity).toBe(3);
  });

  it('renders an endless strip with grouping (one value per group)', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'],
      distribution: { mode: 'order', grouping: { kind: 'everyN', n: 2 } },
    });
    const before = previewRevision.value;
    renderStrip(m, 8, { rankCount: 4 });
    await ready(before);
    const r = renderStrip(m, 8, { rankCount: 4, timeMs: 300 })!;
    expect(r.values.length).toBe(8);
    // Ranks 0 and 2 (group 0) equal, ranks 1 and 3 (group 1) equal.
    expect(r.values[0]).toBeCloseTo(r.values[4]!);
    expect(r.values[2]).toBeCloseTo(r.values[6]!);
  });

  // ── renderPoints (version preview of an effect on fixtures) ──

  /** `n` single-head fixtures in a row, ranked left to right. */
  const row = (n: number): PreviewPoint[] => Array.from({ length: n }, (_, i) => ({ x: 0.1 + 0.1 * i, y: 0.5, fixtureRank: i, head: 0, headCount: 1, fixture: i, fixtureCount: n }));

  it('renders fixture points with order ranks (equal ranks → equal values)', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'],
      distribution: { mode: 'order' },
    });
    const before = previewRevision.value;
    expect(renderPoints(m, row(4), { rankCount: 4 })).toBeNull();
    await ready(before);
    const pts = row(4);
    pts.push({ ...pts[1]!, x: 0.9 }); // same rank as #1 elsewhere
    const r = renderPoints(m, pts, { rankCount: 4, timeMs: 250 })!;
    expect(r.values.length).toBe(5);
    expect(r.values[4]).toBeCloseTo(r.values[1]!);
    expect(new Set(Array.from(r.values.slice(0, 4)).map(v => v.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('spreads heads of a multi-beam fixture with scope within', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), {
      targetChannels: ['DIMMER'],
      distribution: { scope: 'within' },
    });
    const heads: PreviewPoint[] = Array.from({ length: 8 }, (_, h) => ({ x: 0.5, y: 0.5, fixtureRank: -1, head: h, headCount: 8 }));
    const before = previewRevision.value;
    renderPoints(m, heads);
    await ready(before);
    const r = renderPoints(m, heads, { timeMs: 100 })!;
    expect(new Set(Array.from(r.values).map(v => v.toFixed(3))).size).toBeGreaterThan(2);
  });

  it('uses a separate instance slot per instanceKey with the same seeds', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.noise), { targetChannels: ['DIMMER'] });
    let before = previewRevision.value;
    renderPoints(m, row(6));
    await ready(before);
    const own = renderPoints(m, row(6), { timeMs: 500 })!;
    // The keyed slot is separate: first call loads.
    before = previewRevision.value;
    expect(renderPoints(m, row(6), { timeMs: 500, instanceKey: 'version-preview' })).toBeNull();
    await ready(before);
    const keyed = renderPoints(m, row(6), { timeMs: 500, instanceKey: 'version-preview' })!;
    expect(Array.from(keyed.values)).toEqual(Array.from(own.values));
    releasePreview('version-preview');
  });

  it('applies per-point bases for rgb modifiers', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.colorAdjust), { signature: 'rgb' });
    const pts: PreviewPoint[] = [
      { x: 0.2, y: 0.5, fixtureRank: -1, head: 0, headCount: 1, base: [1, 0, 0] },
      { x: 0.2, y: 0.5, fixtureRank: -1, head: 0, headCount: 1, base: [0, 0, 1] },
    ];
    const before = previewRevision.value;
    renderPoints(m, pts);
    await ready(before);
    const r = renderPoints(m, pts)!;
    expect(r.arity).toBe(3);
    expect(Array.from(r.values.slice(0, 3))).not.toEqual(Array.from(r.values.slice(3, 6)));
  });
});
