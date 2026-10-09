/**
 * Regression: the property tabs must appear when a fixture is added to an
 * empty project. The scene array is mutated in place (shallowRef +
 * triggerRef), so `props.nodes` keeps its identity; the tab computation has
 * to track the selection and the model tick explicitly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { bumpModelTick } from '~/utils/extensions/model-tick';

beforeAll(() => {
  // EffectEngine spawns a worker in the browser; not needed here.
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
});

beforeEach(() => setActivePinia(createPinia()));

/** Titles of the visible tab buttons. */
function visibleTabs(html: HTMLElement): string[] {
  return [...html.querySelectorAll('button[title$="Properties"]')]
    .filter(b => (b as HTMLElement).style.display !== 'none')
    .map(b => b.getAttribute('title')!);
}

describe('FixturePropertiesSidebar', () => {
  it('shows the tabs of a fixture added to an empty scene', async () => {
    const { useEngineStore } = await import('~/stores/engine-store');
    const store = useEngineStore();
    const Sidebar = (await import('./FixturePropertiesSidebar.vue')).default;
    const nodes: SceneNode[] = [];
    const w = mount(Sidebar, {
      props: { selectedIds: new Set<string | number>(), fixtures: [], nodes },
      global: { provide: { effectEngine: store.engine }, stubs: { ClientOnly: true } },
      attachTo: document.body,
    });
    await flushPromises();
    expect(visibleTabs(w.element as HTMLElement)).toEqual([]);

    // Same as AddFixturesCommand + selection: push in place, then select.
    const f = Fixture.createRGBFixture('f1');
    nodes.push(f);
    bumpModelTick();
    await w.setProps({ selectedIds: new Set(['f1']), fixtures: [f], nodes });
    await nextTick();
    expect(visibleTabs(w.element as HTMLElement)).toContain('Color Properties');
    w.unmount();
  });
});
