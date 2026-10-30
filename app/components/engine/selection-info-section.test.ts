/**
 * The selection inspector (left sidebar) renders the extension slot
 * `selection:after` below the fields of a single selected fixture, with the
 * `fixture` scope of that fixture; multi-selections render no slot at all.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import { Fixture } from '~/utils/engine/core/fixture';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { useScope } from '~/composables/extensions/use-scope';

beforeAll(() => {
  // EffectEngine spawns a worker in the browser; not needed here.
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
});

/** Registers two contributions: one naming the scoped fixture, one without `when`. */
function registerDemo() {
  registerExtension({
    id: 'selection-demo', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Demo', description: 'Selection slot demo.',
    contributes: {
      slots: [
        {
          slot: 'selection:after',
          when: s => !!s.fixture,
          component: defineComponent({
            setup() {
              const fixture = useScope('fixture');
              return () => h('p', { 'data-demo-fixture': '' }, `fixture:${fixture.value?.id}`);
            },
          }),
        },
        // No `when`: shows whether the slot itself is rendered.
        { slot: 'selection:after', component: defineComponent(() => () => h('p', { 'data-demo-plain': '' }, 'plain')) },
      ],
    },
  });
}

describe('SelectionInfoSection', () => {
  it('renders selection:after for a single fixture with its scope, and nothing for a multi-selection', async () => {
    registerDemo();
    const Section = (await import('./SelectionInfoSection.vue')).default;
    const a = Fixture.createRGBFixture('a');
    const b = Fixture.createRGBFixture('b');
    const w = mount(Section, {
      props: { selectedFixtures: [a], allFixtures: [a, b] },
      attachTo: document.body,
    });
    await flushPromises();

    const after = w.find('[data-selection-after]');
    expect(after.find('[data-demo-fixture]').text()).toBe('fixture:a');
    expect(after.find('[data-demo-plain]').exists()).toBe(true);
    // Inside the `selection` section, below the fixture's DMX fields.
    const section = w.find('[data-pm-section="selection"]');
    expect(section.find('[data-selection-after]').exists()).toBe(true);
    const dmx = w.findAll('label').find(l => l.text() === 'DMX Settings')!.element;
    expect(dmx.compareDocumentPosition(after.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Another single fixture: the scope follows.
    await w.setProps({ selectedFixtures: [b] });
    await nextTick();
    expect(w.find('[data-demo-fixture]').text()).toBe('fixture:b');

    // Two fixtures: no slot (not even contributions without `when`).
    await w.setProps({ selectedFixtures: [a, b] });
    await nextTick();
    expect(w.find('[data-selection-after]').exists()).toBe(false);
    expect(w.find('[data-demo-fixture]').exists()).toBe(false);
    expect(w.find('[data-demo-plain]').exists()).toBe(false);
    w.unmount();
  }, 30_000); // Imports the inspector tree; slow under a parallel full run.
});
