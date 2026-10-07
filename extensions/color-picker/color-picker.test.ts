/**
 * Plan P2.1 acceptance: the property sidebar color control renders the HSV
 * wheel with the extension and the core RGB faders + hex without it; both
 * write the fixture's RGB channels.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { resetRegistry, registerExtension } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { resetReplacementState } from '~/utils/extensions/replacements';
import { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelSection } from '~/components/engine/composables/use-channel-sections';
import FixtureColorControl from '~/components/engine/FixtureColorControl.vue';
import colorPicker from './extension';
import ColorPicker from './components/ColorPicker.vue';
import { hsvToRgb, rgbToHsv } from './utils/hsv';

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
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

/** Channel sections of one DRGB fixture (as the sidebar's color tab builds them). */
function sectionsFor(fixture: Fixture): ChannelSection[] {
  return [{
    name: '',
    showLabel: false,
    entries: (['RED', 'GREEN', 'BLUE'] as const).map(t => ({ channelType: t, oflChannelName: t, fixtures: [fixture] })),
  }];
}

describe('color-picker extension', () => {
  it('without the extension: core faders + hex field write the channels', async () => {
    const fixture = Fixture.createRGBFixture('a');
    const w = mount(FixtureColorControl, { props: { channelSections: sectionsFor(fixture), activeStep: 0 } });
    expect(w.findAll('[role="slider"]')).toHaveLength(3);
    const hex = w.find('input[aria-label="Hex color"]');
    expect((hex.element as HTMLInputElement).value).toBe('#ffffff');

    await hex.setValue('#ff8000');
    await hex.trigger('keydown', { key: 'Enter' });
    expect(fixture.channels.slice(0, 3).map(c => c.chaserConfig.stepValues[0])).toEqual([255, 128, 0]);
  });

  it('with the extension: the HSV wheel replaces the core input', () => {
    registerExtension(colorPicker, 'test');
    const fixture = Fixture.createRGBFixture('b');
    const w = mount(FixtureColorControl, { props: { channelSections: sectionsFor(fixture), activeStep: 0 } });
    expect(w.find('[role="slider"][aria-label="Color"]').exists()).toBe(true);
    expect(w.find('input[aria-label="Hex color"]').exists()).toBe(false);
  });

  it('wheel drag emits one scrub with colors from the pointer position', async () => {
    const w = mount(ColorPicker, { props: { modelValue: { r: 1, g: 1, b: 1 } } });
    const wheel = w.find('[role="slider"]');
    // 100×100 wheel at the origin.
    (wheel.element as HTMLElement).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
    await wheel.trigger('pointerdown', { button: 0, clientX: 50, clientY: 0, pointerId: 1 }); // top edge = red
    await wheel.trigger('pointerup');
    const updates = w.emitted('update:modelValue') as [{ r: number; g: number; b: number }][];
    expect(updates[0]![0].r).toBeCloseTo(1);
    expect(updates[0]![0].g).toBeCloseTo(0);
    expect(w.emitted('scrubStart')).toHaveLength(1);
    expect(w.emitted('scrubEnd')).toHaveLength(1);
  });

  it('hsv conversion round-trips', () => {
    for (const c of [{ r: 1, g: 0.5, b: 0 }, { r: 0.2, g: 0.4, b: 0.9 }, { r: 0, g: 0, b: 0 }]) {
      const back = hsvToRgb(rgbToHsv(c));
      expect(back.r).toBeCloseTo(c.r);
      expect(back.g).toBeCloseTo(c.g);
      expect(back.b).toBeCloseTo(c.b);
    }
  });
});
