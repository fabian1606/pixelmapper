/**
 * Regression: the property tabs must appear when a fixture is added to an
 * empty project. The scene array is mutated in place (shallowRef +
 * triggerRef), so `props.nodes` keeps its identity; the tab computation has
 * to track the selection and the model tick explicitly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { useScope } from '~/composables/extensions/use-scope';

beforeAll(() => {
  // EffectEngine spawns a worker in the browser; not needed here.
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useRoute', () => ({ params: { id: 'p1' }, path: '/project/p1' }));
  vi.stubGlobal('useSupabaseClient', () => ({}));
  vi.stubGlobal('useSupabaseUser', () => ({ value: null }));
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
});

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
  }, 30_000); // Imports the whole sidebar tree; slow under a parallel full run.

  it('shows properties:after below the open category, for a single selection only', async () => {
    // A contribution that names the fixture it sees (the panel provides `fixture` for one selected fixture).
    registerExtension({
      id: 'after-demo', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Demo', description: 'Panel slot demo.',
      contributes: {
        slots: [{
          slot: 'properties:after',
          when: s => !!s.fixture,
          component: defineComponent({
            setup() {
              const fixture = useScope('fixture');
              return () => h('p', { 'data-demo': '' }, `after:${fixture.value?.id}`);
            },
          }),
        }],
      },
    });
    const { useEngineStore } = await import('~/stores/engine-store');
    const store = useEngineStore();
    const Sidebar = (await import('./FixturePropertiesSidebar.vue')).default;
    const a = Fixture.createRGBFixture('a');
    const b = Fixture.createRGBFixture('b');
    const nodes: SceneNode[] = [a, b];
    const w = mount(Sidebar, {
      props: { selectedIds: new Set<string | number>(['a']), fixtures: [a, b], nodes },
      global: { provide: { effectEngine: store.engine }, stubs: { ClientOnly: true } },
      attachTo: document.body,
    });
    await flushPromises();
    // Not mounted behind the closed panel.
    expect(w.find('[data-demo]').exists()).toBe(false);

    (w.vm as unknown as { openTab: (tab: string) => void }).openTab('color');
    await nextTick();
    const after = w.find('[data-properties-after]');
    expect(after.find('[data-demo]').text()).toBe('after:a');
    // Below the category section, inside the panel.
    const section = w.find('[data-pm-section="color"]').element;
    expect(section.compareDocumentPosition(after.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Two fixtures selected: no `fixture` scope, so the contribution is gone.
    await w.setProps({ selectedIds: new Set(['a', 'b']) });
    await nextTick();
    expect(w.find('[data-demo]').exists()).toBe(false);
    w.unmount();
  }, 30_000);
});
