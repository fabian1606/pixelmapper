/**
 * Preview pool (plan P3.14): renders built-in plugins on the main thread.
 * Uses the artifacts of `bun run build:plugins` (skipped when absent).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';
import { previewRevision, renderCycle, renderField } from './preview-pool';

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
    const m = createModifier(builtinHash(BUILTIN_ALIASES.waveform), { targetChannels: ['DIMMER'], direction: 'LINEAR', fanning: 0.5 });
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
});
