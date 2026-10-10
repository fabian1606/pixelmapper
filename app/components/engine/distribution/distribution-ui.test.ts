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

describe('DistributionSection (M4.1)', () => {
  it('offers only the manifest modes, in manifest order', () => {
    const w = mount(DistributionSection, {
      props: { modifierId: 'm1', distribution: createDistribution(), options: { modes: ['order', 'linear', 'radial'], scopes: ['across'] } },
    });
    const modes = w.find('[aria-label="Mode"]').findAll('button').map(b => b.attributes('data-value'));
    expect(modes).toEqual(['order', 'linear', 'radial']);
    expect(w.find('[aria-label="Scope"]').exists()).toBe(false);
  });

  it('switching mode keeps the other fields', async () => {
    const d = createDistribution({ mode: 'linear', reverse: true, grouping: { kind: 'everyN', n: 3 }, origin: { x: 0.1, y: 0.2 } });
    const w = mount(DistributionSection, { props: { modifierId: 'm1', distribution: d } });
    await w.find('[aria-label="Mode"] [data-value="order"]').trigger('click');
    const [next, desc, continuous] = w.emitted('update')![0] as [Distribution, string, boolean];
    expect(next.mode).toBe('order');
    expect(next).toMatchObject({ reverse: true, grouping: { kind: 'everyN', n: 3 }, origin: { x: 0.1, y: 0.2 } });
    expect(desc).toBe('Change Distribution Mode');
    expect(continuous).toBe(false);
  });

  it('order mode shows the tools; Snap only after a line was drawn', async () => {
    const w = mount(DistributionSection, { props: { modifierId: 'm1', distribution: createDistribution({ mode: 'order' }) } });
    expect(w.find('[data-tool="click"]').exists()).toBe(true);
    expect(w.find('[data-snap]').exists()).toBe(false);
    await w.find('[data-tool="line"]').trigger('click');
    expect(useDistributionToolStore().tool).toBe('line');
    await w.setProps({ distribution: createDistribution({ mode: 'order', order: { line: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } } }) });
    expect(w.find('[data-snap]').exists()).toBe(true);
  });

  it('required grouping hides "None"', () => {
    const w = mount(DistributionSection, {
      props: { modifierId: 'm1', distribution: createDistribution({ mode: 'order', grouping: { kind: 'everyN', n: 2 } }), options: { grouping: 'required' } },
    });
    expect(w.find('[aria-label="Grouping"]').findAll('button').map(b => b.text())).toEqual(['Every N', 'Sections', 'Random']);
  });
});

describe('OrderTool (M4.3)', () => {
  /** Mounts the tool over a 100 × 100 viewport (world = viewport px, world size 100). */
  function mountTool(tool: 'click' | 'line', d: Distribution, hits: Record<string, string>, targets?: string[]) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    return mount(OrderTool, {
      props: {
        tool, modifier: modifier(d, targets), worldWidth: 100, worldHeight: 100,
        viewportToWorld: (x: number, y: number) => ({ x, y }),
        hitTest: (x: number, y: number) => hits[`${x},${y}`] ?? null,
      },
    });
  }

  it('click sequence assigns ranks; Shift-click shares; non-targets ignored', async () => {
    const hits = { '10,10': 'a', '20,10': 'b', '30,10': 'c', '40,10': 'x' };
    let d = createDistribution({ mode: 'order', order: { ranks: { old: 4 } } });
    const w = mountTool('click', d, hits, ['a', 'b', 'c']);
    const click = async (x: number, shiftKey = false) => {
      await w.trigger('pointerdown', { button: 0, clientX: x, clientY: 10, shiftKey });
      const ev = w.emitted('change');
      if (ev) {
        d = ev.at(-1)![0] as Distribution;
        await w.setProps({ modifier: modifier(d, ['a', 'b', 'c']) });
      }
    };
    await click(10);
    await click(20);
    await click(30, true);
    await click(40);
    expect(d.order.ranks).toEqual({ a: 0, b: 1, c: 1 });
  });

  it('a drawn line stores the line and clears clicked ranks (one commit)', async () => {
    const w = mountTool('line', createDistribution({ mode: 'order', order: { ranks: { a: 2 } } }), {});
    await w.trigger('pointerdown', { button: 0, clientX: 50, clientY: 0 });
    await w.trigger('pointermove', { clientX: 50, clientY: 100 });
    await w.trigger('pointerup');
    const d = w.emitted('change')![0]![0] as Distribution;
    expect(d.order.ranks).toEqual({});
    expect(d.order.line).toEqual({ a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } });
    expect(w.emitted('commit')).toEqual([['Draw Order Line']]);
  });

  it('a line on a symmetric double row gives pairs; snap merges or splits clusters', () => {
    const rig = Array.from({ length: 6 }, (_, i) => [
      { id: `l${i}`, x: 0.3, y: 0.1 + i * 0.1 + (i % 2) * 0.01 },
      { id: `r${i}`, x: 0.7, y: 0.1 + i * 0.1 },
    ]).flat();
    const line = { a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 1 } };
    const paired = resolveRanks({ order: { ranks: {}, line, snap: 0.5 } }, rig);
    expect(paired.rankCount).toBe(6);
    for (let i = 0; i < 6; i++) expect(paired.ranks[`l${i}`]).toBe(paired.ranks[`r${i}`]);
    // Snap 0 splits the jittered pairs again.
    expect(resolveRanks({ order: { ranks: {}, line, snap: 0 } }, rig).rankCount).toBe(9);
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
    useDistributionToolStore().toggle('click', 'm1');
    sel.onViewportMouseDown(new MouseEvent('mousedown', { button: 0, clientX: 5, clientY: 5 }), { left: 0, top: 0 } as DOMRect);
    expect([...selected.value]).toEqual(['keep']);
    expect(sel.interaction.value.type).toBe('idle');
  });
});
