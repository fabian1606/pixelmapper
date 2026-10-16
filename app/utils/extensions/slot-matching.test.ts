import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { defineExtension, useExtensionContext, type SlotContribution, type SharedGlobals } from '@pixelmapper/extension-api';
import { getSlotContributions, matchesSlot, parseSlotId, resolveSlot } from './slot-matching';
import { registerExtension, resetRegistry, type OwnedContribution } from './registry';
import { provideSlotPath } from './slot-path';
import { provideScope } from '~/composables/extensions/provide-scope';
import { useExtensionContext as hostUseExtensionContext } from '~/composables/extensions/use-extension-context';
import ExtensionSlot from '~/components/extension-host/ExtensionSlot.vue';

describe('slot id parsing and globs', () => {
  it('parses path and position', () => {
    expect(parseSlotId('properties/color:actions')).toEqual({ path: ['properties', 'color'], position: 'actions' });
  });

  it.each([
    ['properties/color:actions', 'properties/color:actions', true],
    ['properties/color:actions', 'properties/color:after', false],
    ['properties/color:actions', 'properties/beam:actions', false],
    ['properties/*:actions', 'properties/color:actions', true],
    ['properties/*:actions', 'properties:actions', false],
    ['properties/*:actions', 'properties/color/x:actions', false],
    ['*:header', 'properties:header', true],
    ['**:actions', 'properties:actions', true],
    ['**:actions', 'properties/color:actions', true],
    ['**:actions', 'scene/fixture:actions', true],
    ['library/**:items', 'library:items', true],
    ['library/**:items', 'library/par/led:items', true],
    ['library/**:items', 'scene/library:items', false],
    ['**/fixture:badges', 'scene/fixture:badges', true],
    ['**/fixture:badges', 'fixture:badges', true],
    ['**/fixture:badges', 'scene/fixtures:badges', false],
    ['properties/**/fader:*', 'properties/color/fader:before', true],
    ['properties.x:actions', 'propertiesXx:actions', false],
  ])('%s matches %s → %s', (pattern, id, expected) => {
    expect(matchesSlot(pattern, id)).toBe(expected);
  });
});

describe('ordering', () => {
  const c = (extensionId: string, slot: string, priority?: number): OwnedContribution<'slots'> => ({
    extensionId,
    contribution: { slot, priority, menuItem: { label: extensionId, action: () => {} } } as SlotContribution,
  });

  it('sorts by priority desc, then extension id', () => {
    const resolved = resolveSlot('a:actions', [
      c('zeta', 'a:actions'),
      c('beta', '**:actions', 5),
      c('alpha', 'a:actions'),
      c('gamma', 'b:actions', 100),
      c('omega', '*:actions', -1),
    ]);
    expect(resolved.map(r => r.extensionId)).toEqual(['beta', 'alpha', 'zeta', 'omega']);
  });
});

describe('memoized index', () => {
  beforeEach(() => resetRegistry());

  it('rebuilds when the registry changes', () => {
    const Dummy = defineComponent({ render: () => null });
    expect(getSlotContributions('x:actions')).toHaveLength(0);
    registerExtension(defineExtension({
      id: 'one', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'One', description: 'd',
      contributes: { slots: [{ slot: '*:actions', component: Dummy }] },
    }), 'test');
    expect(getSlotContributions('x:actions')).toHaveLength(1);
  });
});

describe('ExtensionSlot', () => {
  beforeEach(() => {
    resetRegistry();
    // Minimal host so API composables resolve inside contributions.
    globalThis.__PIXELMAPPER_SHARED__ = {
      vue: {}, pinia: {},
      api: { useExtensionContext: hostUseExtensionContext } as unknown as SharedGlobals['api'],
    };
  });

  /** A primitive-like wrapper that provides a path segment. */
  const Seg = defineComponent({
    props: { id: { type: String, required: true } },
    setup(props, { slots }) {
      provideSlotPath(() => props.id);
      return () => h('section', slots.default?.());
    },
  });

  it('renders contributions with context, respects `when`, and renders nothing when empty', () => {
    const Label = defineComponent({
      setup() {
        const ctx = useExtensionContext();
        return () => h('span', { class: 'label' }, `${ctx.extensionId}@${ctx.slotId}`);
      },
    });
    registerExtension(defineExtension({
      id: 'debug', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'D', description: 'd',
      contributes: {
        slots: [
          { slot: '**:actions', component: Label },
          { slot: 'properties/*:actions', component: Label, when: s => s.fixture?.name === 'Par' },
        ],
      },
    }), 'test');

    const wrapper = mount(() => h(Seg, { id: 'properties' }, () => h(Seg, { id: 'color' }, () => [
      h(ExtensionSlot, { position: 'actions' }),
      h(ExtensionSlot, { position: 'after' }),
    ])));

    const labels = wrapper.findAll('.label').map(w => w.text());
    expect(labels).toEqual(['debug@properties/color:actions']);
    // The empty `after` slot adds no element.
    expect(wrapper.find('section section').element.children.length).toBe(1);
  });

  it('re-evaluates `when` against provided scopes', () => {
    const Label = defineComponent({ render: () => h('span', { class: 'label' }, 'x') });
    registerExtension(defineExtension({
      id: 'cond', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'C', description: 'd',
      contributes: { slots: [{ slot: 'p:actions', component: Label, when: s => s.fixture?.name === 'Par' }] },
    }), 'test');

    const Provider = defineComponent({
      setup(_, { slots }) {
        provideScope('fixture', () => ({
          id: 1, name: 'Par', startAddress: 1, universe: 1, localAddress: 1,
          position: { x: 0, y: 0 }, size: { x: 1, y: 1 }, rotation: 0, positionZ: 0,
          manufacturer: '', fixtureType: '', channels: [], beams: [],
        }));
        return () => slots.default?.();
      },
    });
    const wrapper = mount(() => h(Provider, () => h(Seg, { id: 'p' }, () => h(ExtensionSlot, { position: 'actions' }))));
    expect(wrapper.findAll('.label')).toHaveLength(1);
  });

  it('renders menu items via the menu-item slot', async () => {
    let clicked = 0;
    registerExtension(defineExtension({
      id: 'menu', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'M', description: 'd',
      contributes: { slots: [{ slot: 'ctx:items', menuItem: { label: 'Do it', action: () => { clicked++; } } }] },
    }), 'test');

    const wrapper = mount(() => h(ExtensionSlot, { id: 'ctx:items' }));
    await wrapper.find('button').trigger('click');
    expect(wrapper.text()).toBe('Do it');
    expect(clicked).toBe(1);
  });

  it('isolates a throwing contribution', () => {
    const Boom = defineComponent({ setup() { throw new Error('boom'); } });
    const Ok = defineComponent({ render: () => h('i', { class: 'ok' }) });
    registerExtension(defineExtension({
      id: 'bad', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'B', description: 'd',
      contributes: { slots: [{ slot: 'z:actions', component: Boom }, { slot: 'z:actions', component: Ok }] },
    }), 'test');
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    const wrapper = mount(() => h(ExtensionSlot, { id: 'z:actions' }));
    console.error = orig;
    expect(wrapper.findAll('.ok')).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});
