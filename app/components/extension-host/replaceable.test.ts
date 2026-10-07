/**
 * Plan P1.7 acceptance: replacing `pm.fader` changes the property sidebar
 * fader and the live slider; conflict resolution via per-user choice.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineExtension, type ExtensionManifest } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import {
  CORE_CHOICE,
  pendingConflicts,
  resetReplacementState,
  setReplacementChoice,
} from '~/utils/extensions/replacements';
import { Fixture } from '~/utils/engine/core/fixture';
import Replaceable from './Replaceable.vue';

/** A replacement fader that records its props. */
function customFader(tag: string) {
  return defineComponent({
    props: ['modelValue', 'variant', 'orientation'],
    emits: ['update:modelValue', 'scrubStart', 'scrubEnd'],
    setup: (props, { emit }) => () => h('i', {
      class: tag,
      'data-value': props.modelValue,
      onClick: () => { emit('scrubStart'); emit('update:modelValue', 128); emit('scrubEnd'); },
    }),
  });
}

/** Manifest replacing pm.fader. */
function faderExtension(id: string, tag: string): ExtensionManifest {
  return defineExtension({
    id, version: '1.0.0', apiVersion: '^1.0.0', displayName: id, description: 'Custom fader.',
    contributes: { replaces: [{ replaces: 'pm.fader', component: customFader(tag) }] },
  });
}

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  // Nuxt auto-import used by the engine store.
  vi.stubGlobal('useRouter', () => ({ push: () => {} }));
  vi.stubGlobal('useRoute', () => ({ params: {}, path: '/' }));
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  localStorage.clear();
  resetReplacementState();
  installSharedGlobals();
});

describe('pm.fader replacement', () => {
  it('changes the property sidebar fader and the live slider', async () => {
    registerExtension(faderExtension('fancy-fader', 'fancy'), 'test');

    // Property sidebar channel control.
    const FixturePropertyControl = (await import('~/components/engine/FixturePropertyControl.vue')).default;
    const fixture = Fixture.createRGBFixture('f1');
    const control = mount(FixturePropertyControl, {
      props: { type: 'RED', fixtures: [fixture], activeStep: 0 },
    });
    expect(control.find('i.fancy').exists()).toBe(true);
    expect(control.find('[role="slider"]').exists()).toBe(false);

    // Writing through the replacement updates the channel as one history step.
    await control.find('i.fancy').trigger('click');
    expect(fixture.channels[0]!.chaserConfig.stepValues[0]).toBe(128);

    // Live slider widget.
    const LiveSliderWidget = (await import('~/components/live/LiveSliderWidget.vue')).default;
    const slider = mount(LiveSliderWidget, {
      props: {
        widget: { id: 'w', type: 'slider', gridX: 0, gridY: 0, gridW: 1, gridH: 2, mapping: { type: 'none' } },
        pageId: 'p', editMode: false,
      },
    });
    expect(slider.find('i.fancy').exists()).toBe(true);
  });

  it('uses the core default without replacements', () => {
    const w = mount(() => h(Replaceable, { name: 'pm.fader', modelValue: 0.5 }));
    expect(w.find('[role="slider"]').attributes('aria-valuenow')).toBe('0.5');
  });

  it('on conflict uses the default until the user chooses, then the choice', async () => {
    registerExtension(faderExtension('a-fader', 'a'), 'test');
    registerExtension(faderExtension('b-fader', 'b'), 'test');
    const w = mount(() => h(Replaceable, { name: 'pm.fader', modelValue: 0.5 }));
    await flushPromises();
    expect(w.find('[role="slider"]').exists()).toBe(true);
    expect(pendingConflicts.value).toEqual(['pm.fader']);

    setReplacementChoice('pm.fader', 'b-fader');
    await nextTick();
    expect(w.find('i.b').exists()).toBe(true);
    expect(pendingConflicts.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem('pm.replacements')!)).toEqual({ 'pm.fader': 'b-fader' });

    setReplacementChoice('pm.fader', CORE_CHOICE);
    await nextTick();
    expect(w.find('[role="slider"]').exists()).toBe(true);
  });
});
