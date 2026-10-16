import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { defineExtension, useExtensionContext, type SharedGlobals } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { useExtensionContext as hostUseExtensionContext } from '~/composables/extensions/use-extension-context';
import PmPanel from './PmPanel.vue';
import PmPanelSection from './PmPanelSection.vue';
import PmToolbar from './PmToolbar.vue';
import PmMenuGroup from './PmMenuGroup.vue';
import PmListItem from './PmListItem.vue';

/** Renders `[slotId]` for every slot it is placed in. */
const SlotLabel = defineComponent({
  setup() {
    const ctx = useExtensionContext();
    return () => h('b', `[${ctx.slotId}]`);
  },
});

beforeEach(() => {
  resetRegistry();
  globalThis.__PIXELMAPPER_SHARED__ = {
    vue: {}, pinia: {},
    api: { useExtensionContext: hostUseExtensionContext } as unknown as SharedGlobals['api'],
  };
  registerExtension(defineExtension({
    id: 'debug', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Debug', description: 'Labels every slot.',
    contributes: { slots: [{ slot: '**:*', component: SlotLabel }] },
  }), 'test');
});

/** Collected slot labels in document order. */
const labels = (html: string) => [...html.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);

describe('layout primitives', () => {
  it('PmPanel + PmPanelSection produce nested slot ids in default order', () => {
    const w = mount(() => h(PmPanel, { id: 'properties' }, () =>
      h(PmPanelSection, { id: 'color', title: 'Color' }, () => h('p', 'content'))));
    expect(labels(w.text())).toEqual([
      'properties:header',
      'properties:before',
      'properties/color:before',
      'properties/color:actions',
      'properties/color:items',
      'properties/color:after',
      'properties:after',
    ]);
  });

  it('PmPanelSection passes attrs to its root and renders before/after as siblings', () => {
    const w = mount(() => h('div', h(PmPanelSection, { id: 's', class: 'my-section' }, () => h('p', 'x'))));
    const root = w.find('.my-section');
    expect(root.exists()).toBe(true);
    expect(root.text()).not.toContain('[s:before]');
    expect(w.text()).toContain('[s:before]');
  });

  it('PmToolbar places start and end around the content', () => {
    const w = mount(() => h(PmToolbar, { id: 'header' }, () => h('i', 'mid')));
    expect(w.text()).toBe('[header:start]mid[header:end]');
  });

  it('PmMenuGroup appends items', () => {
    const w = mount(() => h(PmMenuGroup, { id: 'add' }, () => h('i', 'a')));
    expect(w.text()).toBe('a[add:items]');
  });

  it('PmListItem honours manual placement via slot props', () => {
    const w = mount(() => h(PmPanel, { id: 'scene' }, () =>
      h(PmListItem, { id: 'fixture', manual: ['badges'] }, {
        default: ({ Badges }: { Badges: never }) => [h('span', 'name'), h(Badges)],
      })));
    const text = w.text();
    expect(text).toContain('name[scene/fixture:badges][scene/fixture:actions]');
    expect(labels(w.text()).filter(l => l === 'scene/fixture:badges')).toHaveLength(1);
  });
});
