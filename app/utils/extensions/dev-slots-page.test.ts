/**
 * Dev slot catalog (plan P7.3): lists recorded slots with scopes and
 * contributing extensions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { recordRenderedSlot, renderedSlots } from '~/utils/extensions/slot-matching';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';

beforeEach(() => {
  renderedSlots.clear();
  resetRegistry();
  vi.stubGlobal('createError', (e: unknown) => e);
});

describe('/dev/slots', () => {
  it('lists recorded slots with scopes and contributions', async () => {
    registerExtension({
      id: 'demo', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Demo', description: 'Slot demo.',
      contributes: { slots: [{ slot: 'properties/*:actions', component: defineComponent({ render: () => h('i') }) }] },
    });
    recordRenderedSlot('properties/color:actions', ['fixture']);
    recordRenderedSlot('scene:header', []);
    const Page = (await import('~/pages/dev/slots.vue')).default;
    const w = mount(Page, { global: { stubs: { NuxtLink: true } } });
    const text = w.text();
    expect(text).toContain('properties/color:actions');
    expect(text).toContain('fixture');
    expect(text).toContain('demo');
    expect(text).toContain('scene:header');
  });
});
