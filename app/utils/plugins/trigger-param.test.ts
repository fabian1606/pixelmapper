// @vitest-environment node
/**
 * ABI 1.3 trigger params on the host: edge application on a modifier's params
 * at engine-clock time (card button and live `effect-param` buttons).
 */
import { describe, expect, it } from 'vitest';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import { engineClockMs, isTriggerParam, paramsAfterTriggerEdge } from './trigger-param';

const manifest = {
  params: [
    { type: 'number', key: 'gain', label: 'Gain', min: 0, max: 1, default: 1 },
    { type: 'trigger', key: 'hit', label: 'Hit', default: { pressed: false }, multiClickMs: 300 },
  ],
} as unknown as ContentPluginManifest;

describe('trigger params on the host', () => {
  it('stamps edges with the engine clock (wall time − epoch)', () => {
    expect(engineClockMs(10_000, 12_500)).toBe(2500);
  });

  it('detects trigger params', () => {
    expect(isTriggerParam(manifest, 'hit')).toBe(true);
    expect(isTriggerParam(manifest, 'gain')).toBe(false);
    expect(isTriggerParam(undefined, 'hit')).toBe(false);
  });

  it('applies press/release and counts a double click within the param window', () => {
    let params: Record<string, unknown> = { gain: 0.5 };
    params = paramsAfterTriggerEdge(manifest, params, 'hit', true, 1000)!;
    params = paramsAfterTriggerEdge(manifest, params, 'hit', false, 1080)!;
    params = paramsAfterTriggerEdge(manifest, params, 'hit', true, 1300)!;
    expect(params).toEqual({ gain: 0.5, hit: { pressed: true, pressedAt: 1300, releasedAt: 1080, clicks: 2 } });
    // Outside the 300 ms window → new burst.
    params = paramsAfterTriggerEdge(manifest, params, 'hit', false, 1350)!;
    expect((paramsAfterTriggerEdge(manifest, params, 'hit', true, 1700)!.hit as { clicks: number }).clicks).toBe(1);
  });

  it('ignores non-trigger keys and repeated edges', () => {
    expect(paramsAfterTriggerEdge(manifest, {}, 'gain', true, 0)).toBeNull();
    const held = paramsAfterTriggerEdge(manifest, {}, 'hit', true, 0)!;
    expect(paramsAfterTriggerEdge(manifest, held, 'hit', true, 50)).toBeNull();
  });
});
