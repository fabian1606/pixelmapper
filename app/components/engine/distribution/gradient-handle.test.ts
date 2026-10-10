/**
 * Gradient handle on the canvas (plan M4.2): dragging origin/end updates the
 * distribution; the drag commits one undoable SetModifiers step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Load the live bus before the live ops it registers (import-order cycle).
import '~/stores/engine-store';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createDistribution } from '~/utils/engine/distribution/create';
import type { ModifierInstance } from '~/utils/engine/types';
import { SetModifiersCommand } from '../commands/set-modifiers-command';
import FixtureEditorSpatialControls from '../FixtureEditorSpatialControls.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
  vi.stubGlobal('useRouter', () => ({ push: () => {} }));
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
});

/** A linear-mode instance (only fields the handle reads). */
const inst = () => ({
  id: 'm1', params: {}, distribution: createDistribution({ mode: 'linear', origin: { x: 0.2, y: 0.5 }, end: { x: 0.4, y: 0.5 } }),
}) as unknown as ModifierInstance;

/** Mounts the controls in a 1000 × 500 world at camera identity. */
function mountControls(m: ModifierInstance) {
  const viewportEl = document.createElement('div');
  vi.spyOn(viewportEl, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 500 } as DOMRect);
  return mount(FixtureEditorSpatialControls, {
    props: {
      viewportEl, editorWidth: 1000, editorHeight: 500, camera: { x: 0, y: 0, scale: 1 }, activeModifier: m,
      worldWidth: 1000, worldHeight: 500, worldToViewport: (x: number, y: number) => ({ x, y }),
    },
  });
}

describe('gradient handle (M4.2)', () => {
  it('end drag sets the end; origin drag moves the whole handle', async () => {
    const m = inst();
    const w = mountControls(m);
    const [origin, end] = w.findAll('.spatial-handle');
    await end!.trigger('mousedown');
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    const endChange = w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>;
    expect(endChange.distribution!.end).toEqual({ x: 0.6, y: 0.2 });
    expect(w.emitted('modifierDragEnd')).toHaveLength(1);

    await origin!.trigger('mousedown');
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 250 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    const moved = w.emitted('modifierChange')!.at(-1)![1] as Partial<ModifierInstance>;
    expect(moved.distribution!.origin).toEqual({ x: 0.3, y: 0.5 });
    expect(moved.distribution!.end.x).toBeCloseTo(0.5);
  });

  it('shows a radial guide circle and a conical ray', async () => {
    const m = inst();
    m.distribution = { ...m.distribution, mode: 'radial' };
    const w = mountControls(m);
    expect(w.find('[data-guide="radial"]').attributes('rx')).toBe('200');
    await w.setProps({ activeModifier: { ...m, distribution: { ...m.distribution, mode: 'conical' } } });
    expect(w.find('[data-guide="conical"]').exists()).toBe(true);
  });

  it('a drag commits one undoable step', () => {
    const before = [inst()];
    const after = [{ ...inst(), distribution: { ...before[0]!.distribution, end: { x: 0.9, y: 0.5 } } }];
    const engine = { setModifiers: vi.fn() };
    const cmd = new SetModifiersCommand(engine as never, before, after, 'Update Spatial Handle');
    cmd.execute();
    expect(engine.setModifiers.mock.calls[0]![0][0].distribution.end.x).toBe(0.9);
    cmd.undo();
    expect(engine.setModifiers.mock.calls[1]![0][0].distribution.end.x).toBe(0.4);
  });
});
