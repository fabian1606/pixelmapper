/**
 * Noise history editor (plan M9.4, review): range lines and coherence drag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { NoiseHistoryValue } from '@pixelmapper/extension-api';
import PmNoiseHistory from './PmNoiseHistory.vue';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 72, right: 240, bottom: 72, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

const value: NoiseHistoryValue = { min: 0.2, max: 0.8 };
const last = <T>(w: ReturnType<typeof mount>) => w.emitted('update:modelValue')!.at(-1)![0] as T;
const cy = (level: number) => 72 - 6 - level * 60;

/** Drags an element from its spot to (x, y). */
async function drag(w: ReturnType<typeof mount>, sel: string, x: number, y: number) {
  await w.find(sel).trigger('pointerdown', { button: 0, clientX: 0, clientY: 0 });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  window.dispatchEvent(new PointerEvent('pointerup'));
}

describe('pm.noiseHistory', () => {
  it('drags the range lines and draws the traces', async () => {
    const traces = vi.fn(() => [new Float32Array(96).fill(0.5), new Float32Array(96).fill(0.3), new Float32Array(96).fill(0.7)]);
    const w = mount(PmNoiseHistory, { props: { modelValue: value, traces } });
    expect(w.findAll('polyline')).toHaveLength(3);
    await drag(w, '[data-handle="max"]', 50, cy(0.9));
    expect(last<NoiseHistoryValue>(w).max).toBeCloseTo(0.9, 2);
    await drag(w, '[data-handle="min"]', 50, cy(0.1));
    expect(last<NoiseHistoryValue>(w).min).toBeCloseTo(0.1, 2);
  });

  it('dragging the traces up raises the coherence', async () => {
    const w = mount(PmNoiseHistory, { props: { modelValue: { ...value, coherence: 0.2 } } });
    await w.find('[data-noise-history]').trigger('pointerdown', { button: 0, clientX: 50, clientY: 60 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 20 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(last<NoiseHistoryValue>(w).coherence).toBeCloseTo(0.7);
  });
});
