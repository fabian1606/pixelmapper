/**
 * Distribution UI (plan M4.1–M4.5): section options, canvas handle drags,
 * order tools and the selection guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import type { Distribution } from '@pixelmapper/extension-api';
import { createDistribution } from '~/utils/engine/distribution/create';
import { resolveRanks } from '~/utils/engine/distribution/order';
import { useDistributionToolStore } from '~/stores/distribution-tool-store';
import type { ModifierInstance } from '~/utils/engine/types';
import DistributionSection from './DistributionSection.vue';
import OrderTool from './OrderTool.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
});

/** A modifier with a distribution (only the fields the UI reads). */
const modifier = (d: Distribution, targets?: string[]) => ({ id: 'm1', distribution: d, targetFixtureIds: targets }) as unknown as ModifierInstance;

describe('DistributionSection (M4.1, R1)', () => {
  it('offers only the manifest modes, in manifest order', () => {
    const w = mount(DistributionSection, {
      props: { modifierId: 'm1', distribution: createDistribution({ mode: 'linear' }), options: { modes: ['order', 'radial', 'linear'], scopes: ['across'] } },
    });
    const modes = w.find('[aria-label="Mode"]').findAll('button').map(b => b.attributes('data-value'));
    expect(modes).toEqual(['radial', 'linear']);
  });

  it('switching mode keeps the other fields', async () => {
    const d = createDistribution({ mode: 'linear', reverse: true, origin: { x: 0.1, y: 0.2 } });
    const w = mount(DistributionSection, { props: { modifierId: 'm1', distribution: d } });
    await w.find('[aria-label="Mode"] [data-value="radial"]').trigger('click');
    const [next, desc] = w.emitted('update')![0] as [Distribution, string];
    expect(next.mode).toBe('radial');
    expect(next).toMatchObject({ reverse: true, origin: { x: 0.1, y: 0.2 } });
    expect(desc).toBe('Change Distribution Mode');
  });

  it('"Spatial 2D" starts linear with the handle along the selection', async () => {
    const axis = { a: { x: 0.1, y: 0.5 }, b: { x: 0.9, y: 0.5 } };
    const w = mount(DistributionSection, { props: { modifierId: 'm1', distribution: createDistribution({ mode: 'none' }), selectionAxis: axis } });
    (w.vm as unknown as { setSpread: (v: string) => void }).setSpread('spatial');
    const [next] = w.emitted('update')![0] as [Distribution];
    expect(next).toMatchObject({ scope: 'across', mode: 'linear', origin: axis.a, end: axis.b });
  });

  it('order mode has only a Reassign button that starts a session', async () => {
    const w = mount(DistributionSection, { props: { modifierId: 'm1', distribution: createDistribution({ mode: 'order' }) } });
    expect(w.find('[aria-label="Mode"]').exists()).toBe(false);
    expect(w.findAll('button').map(b => b.text())).toContain('Reassign');
    expect(w.text()).not.toMatch(/Snap|Mirror|Grouping|Clear|Reverse/);
    await w.find('[data-reassign]').trigger('click');
    expect(useDistributionToolStore().modifierId).toBe('m1');
    expect(w.find('[data-reassign]').text()).toBe('Done');
  });
});

describe('OrderTool (M4.3, R1)', () => {
  /** Fixtures at viewport x = 10, 20, … (world size 100, camera identity). */
  const fixtures = (ids: string[]) => ids.map((id, i) => ({ id, fixturePosition: { x: (10 + i * 10) / 100, y: 0.1 } })) as never;

  /** Mounts the session over a 100 × 100 viewport. */
  function mountTool(d: Distribution, ids: string[], targets?: string[]) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    const hits = Object.fromEntries(ids.map((id, i) => [`${10 + i * 10},10`, id]));
    return mount(OrderTool, {
      props: {
        modifier: modifier(d, targets), fixtures: fixtures(ids), worldWidth: 100, worldHeight: 100,
        viewportToWorld: (x: number, y: number) => ({ x, y }), worldToViewport: (x: number, y: number) => ({ x, y }),
        hitTest: (x: number, y: number) => hits[`${x},${y}`] ?? null,
      },
    });
  }

  /** Presses and releases at (x, y). */
  async function click(w: ReturnType<typeof mountTool>, x: number, shiftKey = false) {
    await w.trigger('pointerdown', { button: 0, clientX: x, clientY: 10, shiftKey });
    await w.trigger('pointerup', { clientX: x, clientY: 10, shiftKey });
  }

  it('clicks number fixtures 1, 2, 2 (Shift); old numbers are dropped; non-targets ignored', async () => {
    const w = mountTool(createDistribution({ mode: 'order', order: { ranks: { old: 4 } } }), ['a', 'b', 'c', 'x'], ['a', 'b', 'c', 'd']);
    await click(w, 10);
    await click(w, 20);
    await click(w, 30, true);
    await click(w, 40);
    const d = w.emitted('change')!.at(-1)![0] as Distribution;
    expect(d.order.ranks).toEqual({ a: 0, b: 1, c: 1 });
    expect(w.findAll('[data-session-badge]').map(b => b.text())).toEqual(['1', '2', '2']);
    // `d` is not on the canvas, so a, b, c are all targeted fixtures: the session ends.
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('the session ends when every targeted fixture has a number', async () => {
    const w = mountTool(createDistribution({ mode: 'order' }), ['a', 'b']);
    await click(w, 10);
    await click(w, 20);
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('a drag draws a line: stores it, clears clicked numbers, ends the session', async () => {
    const w = mountTool(createDistribution({ mode: 'order', order: { ranks: { a: 2 } } }), ['a', 'b', 'c']);
    await w.trigger('pointerdown', { button: 0, clientX: 0, clientY: 50 });
    await w.trigger('pointermove', { clientX: 100, clientY: 50 });
    await w.trigger('pointerup', { clientX: 100, clientY: 50 });
    const d = w.emitted('change')![0]![0] as Distribution;
    expect(d.order.ranks).toEqual({});
    expect(d.order.line).toEqual({ a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 } });
    expect(d.order.mirror).toBe(false);
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('a line starting inside the rig orders outward on both sides', async () => {
    const w = mountTool(createDistribution({ mode: 'order' }), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    await w.trigger('pointerdown', { button: 0, clientX: 40, clientY: 50 });
    await w.trigger('pointermove', { clientX: 90, clientY: 50 });
    await w.trigger('pointerup', { clientX: 90, clientY: 50 });
    expect((w.emitted('change')![0]![0] as Distribution).order.mirror).toBe(true);
  });

  it('a line on a symmetric double row gives pairs', () => {
    const rig = Array.from({ length: 6 }, (_, i) => [
      { id: `l${i}`, x: 0.3, y: 0.1 + i * 0.1 + (i % 2) * 0.01 },
      { id: `r${i}`, x: 0.7, y: 0.1 + i * 0.1 },
    ]).flat();
    const line = { a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } };
    const paired = resolveRanks({ order: { ranks: {}, line, snap: 0.5 } }, rig);
    expect(paired.rankCount).toBe(6);
    for (let i = 0; i < 6; i++) expect(paired.ranks[`l${i}`]).toBe(paired.ranks[`r${i}`]);
  });
});

describe('selection guard (M4.5)', () => {
  it('clicking fixtures with a tool active does not change the selection', async () => {
    const { useSelection } = await import('../composables/use-selection');
    const selected = ref(new Set<string | number>(['keep']));
    const sel = useSelection(
      () => [], () => 100, () => 100, (x, y) => ({ x, y }), undefined, undefined, selected,
      () => ({ hitTest: () => 'f1', hitTestRotationZone: () => null, hitTestHandle: () => undefined, marqueeSelect: () => [] }) as never,
    );
    useDistributionToolStore().toggle('m1');
    sel.onViewportMouseDown(new MouseEvent('mousedown', { button: 0, clientX: 5, clientY: 5 }), { left: 0, top: 0 } as DOMRect);
    expect([...selected.value]).toEqual(['keep']);
    expect(sel.interaction.value.type).toBe('idle');
  });
});
