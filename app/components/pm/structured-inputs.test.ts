/**
 * Structured pm inputs (plan M7.2, M7.3, M8.2) and canvas palette stops (M7.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { GradientValue, StepsValue } from '@pixelmapper/extension-api';
import PmGradient from './PmGradient.vue';
import PmHueRange from './PmHueRange.vue';
import PmSteps from './PmSteps.vue';
import PaletteStopsOverlay from '~/components/engine/distribution/PaletteStopsOverlay.vue';
import { BUILTIN_ALIASES, builtinHash, createModifier } from '~/utils/engine/modifiers';

const rect = { left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
});
afterEach(() => vi.restoreAllMocks());

const last = <T>(w: ReturnType<typeof mount>) => w.emitted('update:modelValue')!.at(-1)![0] as T;
const red = { r: 1, g: 0, b: 0 };
const blue = { r: 0, g: 0, b: 1 };

describe('pm.gradient', () => {
  it('click on the bar adds an interpolated stop; drag moves; Delete removes', async () => {
    const w = mount(PmGradient, { props: { modelValue: { stops: [{ pos: 0, color: red }, { pos: 1, color: blue }] } } });
    await w.find('[data-gradient-bar]').trigger('pointerdown', { button: 0, clientX: 100 });
    const added = last<GradientValue>(w);
    expect(added.stops).toHaveLength(3);
    expect(added.stops[1]!.color.r).toBeCloseTo(0.5);
    await w.setProps({ modelValue: added });
    await w.find('[data-stop="1"]').trigger('pointerdown', { button: 0, clientX: 100 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(last<GradientValue>(w).stops[1]!.pos).toBeCloseTo(0.75);
    await w.find('[aria-label="Gradient"]').trigger('keydown', { key: 'Delete' });
    expect(last<GradientValue>(w).stops).toHaveLength(2);
  });

  it('pressing a stop focuses the editor, so Delete reaches it (and goes no further)', async () => {
    const w = mount(PmGradient, { props: { modelValue: { stops: [{ pos: 0, color: red }, { pos: 0.5, color: blue }, { pos: 1, color: red }] } }, attachTo: document.body });
    await w.find('[data-stop="1"]').trigger('pointerdown', { button: 0, clientX: 100 });
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(document.activeElement).toBe(w.find('[aria-label="Gradient"]').element);
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    window.removeEventListener('keydown', outer);
    expect(last<GradientValue>(w).stops.map(s => s.pos)).toEqual([0, 1]);
    expect(outer).not.toHaveBeenCalled();
    w.unmount();
  });
});

describe('pm.hueRange', () => {
  it('center drag shifts, edge drag sets the range', async () => {
    const w = mount(PmHueRange, { props: { modelValue: { shift: 0, range: 36 } } });
    // Center at 50 %; range edges at ±10 % (36°/360°).
    await w.find('[data-hue-strip]').trigger('pointerdown', { button: 0, clientX: 150 });
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(last<{ shift: number }>(w).shift).toBe(90);
    await w.find('[data-hue-strip]').trigger('pointerdown', { button: 0, clientX: 121 });
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(last<{ range: number }>(w).range).toBe(72);
  });
});

describe('pm.steps', () => {
  const grid: StepsValue = { groups: 2, steps: 2, cells: [[true, false], [false, true]] };
  it('toggles, paints, adds and removes steps; dims rows beyond the rig', async () => {
    const w = mount(PmSteps, { props: { modelValue: grid, activeGroups: 1, playhead: 1.5 } });
    await w.find('[data-cell="0:1"]').trigger('pointerdown', { button: 0 });
    expect(last<StepsValue>(w).cells[0]).toEqual([true, true]);
    await w.find('[data-cell="1:0"]').trigger('pointerenter');
    expect(last<StepsValue>(w).cells[1]).toEqual([true, true]);
    window.dispatchEvent(new PointerEvent('pointerup'));
    await w.find('[data-add-step]').trigger('click');
    expect(last<StepsValue>(w)).toMatchObject({ steps: 3, cells: [[true, false], [false, true], [false, false]] });
    await w.find('[data-step-header="0"]').trigger('contextmenu');
    expect(last<StepsValue>(w)).toMatchObject({ steps: 1, cells: [[false, true]] });
    expect(w.findAll('tbody tr')[1]!.classes()).toContain('opacity-40');
    expect(w.find('[data-step-header="1"]').classes()).toContain('text-primary');
  });
});

describe('palette stops on the canvas', () => {
  it('dragging a stop along the handle line sets its position', async () => {
    const m = createModifier(builtinHash(BUILTIN_ALIASES.colorAdjust), {
      params: { mode: 'palette' },
      distribution: { mode: 'linear', origin: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    });
    const viewportEl = document.createElement('div');
    const w = mount(PaletteStopsOverlay, {
      props: { modifier: m, worldWidth: 200, worldHeight: 20, worldToViewport: (x: number, y: number) => ({ x, y }), viewportEl, camera: { x: 0, y: 0, scale: 1 } },
    });
    expect(w.findAll('[data-palette-stop]')).toHaveLength(2);
    await w.find('[data-palette-stop="1"]').trigger('mousedown', { clientX: 100, clientY: 0 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    const params = w.emitted('change')!.at(-1)![0] as { palette: GradientValue };
    expect(params.palette.stops[1]!.pos).toBeCloseTo(0.75);
    expect(w.emitted('commit')).toEqual([['Move Palette Stop']]);
  });
});
