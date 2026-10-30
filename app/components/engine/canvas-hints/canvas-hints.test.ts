/**
 * Canvas hints (plan M4): hinted params render handles on the 2D canvas
 * independent of the distribution mode; drags update params live and end
 * in one commit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Load the live bus before the live ops it registers (import-order cycle).
import '~/stores/engine-store';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { ParamSchema } from '@pixelmapper/extension-api';
import { createDistribution } from '~/utils/engine/distribution/create';
import type { ModifierInstance } from '~/utils/engine/types';
import { collectCanvasHandles, pointFromPointer, radiusFromPointer } from './canvas-hint-geometry';
import ModifierCanvasHandles from './ModifierCanvasHandles.vue';

/** Four corner points plus a size ring around the first one. */
const SCHEMA: ParamSchema = [
  { key: 'a', type: 'point', label: 'Corner A', default: { x: 0.1, y: 0.1 }, ui: { canvas: 'point', label: 'A', color: '#ff0000' } },
  { key: 'b', type: 'point', label: 'Corner B', default: { x: 0.9, y: 0.1 }, ui: { canvas: 'point' } },
  { key: 'c', type: 'point', label: 'Hidden', default: { x: 0.5, y: 0.5 }, tier: 'hidden', ui: { canvas: 'point' } },
  { key: 'd', type: 'point', label: 'Card only', default: { x: 0.5, y: 0.5 } },
  { key: 'size', type: 'number', label: 'Size', min: 0.05, max: 0.5, default: 0.2, ui: { canvas: 'radius', anchor: 'a' } },
];

vi.mock('~/utils/plugins/plugin-store', () => ({
  getManifest: () => ({ params: SCHEMA }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
  vi.stubGlobal('useRouter', () => ({ push: () => {} }));
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
});

/** An instance in mode "none" (hints do not depend on the distribution). */
const inst = () => ({
  id: 'm1', plugin: 'sha256:test', params: {}, distribution: createDistribution({ mode: 'none' }),
}) as unknown as ModifierInstance;

/** Mounts the handles in a 1000 × 500 world at camera identity. */
function mountHandles(m: ModifierInstance) {
  const viewportEl = document.createElement('div');
  vi.spyOn(viewportEl, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 500 } as DOMRect);
  return mount(ModifierCanvasHandles, {
    props: {
      viewportEl, editorWidth: 1000, editorHeight: 500, camera: { x: 0, y: 0, scale: 1 }, activeModifier: m,
      worldWidth: 1000, worldHeight: 500, worldToViewport: (x: number, y: number) => ({ x, y }),
    },
  });
}

/** Simulates a window-level drag to (x, y). */
function dragTo(x: number, y: number, altKey = false) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, altKey }));
  window.dispatchEvent(new MouseEvent('mouseup'));
}

describe('canvas hint geometry', () => {
  it('collects visible hinted params, rings first', () => {
    const hs = collectCanvasHandles(SCHEMA, { a: { x: 0.3, y: 0.4 } }, 'none');
    expect(hs.map(h => `${h.kind}:${h.key}`)).toEqual(['radius:size', 'point:a', 'point:b']);
    expect(hs[0]).toMatchObject({ center: { x: 0.3, y: 0.4 }, radius: 0.2 });
    expect(hs[1]).toMatchObject({ label: 'A', color: '#ff0000' });
    expect(hs[2]).toMatchObject({ label: 'Corner B', value: { x: 0.9, y: 0.1 } });
  });

  it('clamps and snaps points, measures radii in world-x units', () => {
    expect(pointFromPointer({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
    expect(pointFromPointer({ x: 0.497, y: 0.3 }, { xs: [0.5], ys: [], tolX: 0.006, tolY: 0.012 })).toEqual({ x: 0.5, y: 0.3 });
    // aspect 2: 0.1 of the height = 0.05 of the width.
    expect(radiusFromPointer({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 }, 2, 0, 1)).toBeCloseTo(0.05);
    expect(radiusFromPointer({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 2, 0.05, 1)).toBe(0.05);
  });
});

describe('ModifierCanvasHandles', () => {
  it('renders one dot per hinted point and a ring per radius param', () => {
    const w = mountHandles(inst());
    expect(w.findAll('.spatial-handle--point').map(e => e.attributes('data-canvas-handle'))).toEqual(['a', 'b']);
    expect(w.findAll('.spatial-handle--knob')).toHaveLength(1);
    // Ring: true circle with r = 0.2 × world width.
    expect(w.find('[data-canvas-ring="size"] circle').attributes('r')).toBe('200');
    expect(w.text()).toContain('A');
    expect(w.text()).toContain('Corner B');
  });

  it('dragging a point updates the param live and commits once', async () => {
    const m = inst();
    const w = mountHandles(m);
    await w.find('[data-canvas-handle="b"]').trigger('mousedown');
    // 1203 px is outside the world → clamped to x = 1.
    dragTo(1203, 100);
    const change = w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>;
    expect(change.params!.b).toEqual({ x: 1, y: 0.2 });
    expect(w.emitted('dragStart')).toHaveLength(1);
    expect(w.emitted('modifierDragEnd')).toHaveLength(1);
  });

  it('snaps to the center unless Alt is held', async () => {
    const w = mountHandles(inst());
    await w.find('[data-canvas-handle="b"]').trigger('mousedown');
    dragTo(497, 300);
    expect((w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>).params!.b).toEqual({ x: 0.5, y: 0.6 });
    await w.find('[data-canvas-handle="b"]').trigger('mousedown');
    dragTo(497, 300, true);
    expect((w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>).params!.b).toEqual({ x: 0.497, y: 0.6 });
  });

  it('dragging the ring knob sets the radius, clamped to the range', async () => {
    const w = mountHandles(inst());
    // Anchor a = (100, 50) px; pointer 300 px right → r = 0.3.
    await w.find('[data-canvas-handle="size"]').trigger('mousedown');
    dragTo(400, 50);
    expect((w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>).params!.size).toBeCloseTo(0.3);
    await w.find('[data-canvas-ring="size"] .canvas-hints-ring-hit').trigger('mousedown');
    dragTo(1000, 50);
    expect((w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>).params!.size).toBe(0.5);
    expect(w.emitted('modifierDragEnd')).toHaveLength(2);
  });
});
