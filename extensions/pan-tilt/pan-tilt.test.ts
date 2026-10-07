/**
 * Plan P2.2 acceptance: the position section shows the core XY faders and no
 * movement range without the extension; with it, the pad replaces pm.xyInput
 * and the movement-range editor appears for pan/tilt selections and commits
 * all ranges as one history entry.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { resetReplacementState } from '~/utils/extensions/replacements';
import { Fixture } from '~/utils/engine/core/fixture';
import type { Channel } from '~/utils/engine/core/channel';
import { useHistory } from '~/components/engine/composables/use-history';
import { provideScope } from '~/composables/extensions/provide-scope';
import panTilt from './extension';

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useRouter', () => ({ push: () => {} }));
  vi.stubGlobal('useRoute', () => ({ params: {}, path: '/' }));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetRegistry();
  localStorage.clear();
  resetReplacementState();
  installSharedGlobals();
});

// Unmount between tests so stale wrappers never re-render into removed DOM.
enableAutoUnmount(afterEach);

/** A moving head with PAN, TILT and DIMMER. */
function movingHead(id: string): Fixture {
  const ch = (type: Channel['type'], addressOffset: number): Channel => ({
    type, addressOffset, role: type === 'DIMMER' ? 'DIMMER' : 'NONE', colorValue: '#ffffff', defaultValue: 0,
    chaserConfig: reactive({
      stepValues: [128], stepsCount: 1, activeEditStep: 0, isPlaying: false,
      stepDuration: { mode: 'beat', timeMs: 1000, beatValue: 1, beatOffset: 0 },
      fadeDuration: { mode: 'beat', timeMs: 0, beatValue: 0, beatOffset: 0 },
    }),
  });
  const f = new Fixture(id, [ch('PAN', 0), ch('TILT', 1), ch('DIMMER', 2)]);
  f.name = `Head ${id}`;
  return f;
}

/** Mounts the property sidebar on the position tab for the given fixtures. */
async function mountPositionTab(fixtures: Fixture[]) {
  const { useEngineStore } = await import('~/stores/engine-store');
  const store = useEngineStore();
  store.sceneNodes = fixtures;
  store.selectedIds = new Set(fixtures.map(f => f.id));
  const FixturePropertiesSidebar = (await import('~/components/engine/FixturePropertiesSidebar.vue')).default;
  // The app root provides the global `selection` scope.
  let sidebar: { openTab: (t: string) => void } | null = null;
  const Root = defineComponent({
    setup() {
      provideScope('selection', () => ({ fixtureIds: fixtures.map(f => f.id), nodeIds: fixtures.map(f => f.id) }));
      return () => h(FixturePropertiesSidebar, {
        ref: (r: unknown) => { sidebar = r as typeof sidebar; },
        selectedIds: new Set(fixtures.map(f => f.id)), fixtures, nodes: fixtures,
      });
    },
  });
  const w = mount(Root, { global: { provide: { effectEngine: store.engine } }, attachTo: document.body });
  sidebar!.openTab('position');
  await nextTick();
  await flushPromises();
  return w;
}

describe('pan-tilt extension', () => {
  it('without the extension: core XY faders, no movement range', async () => {
    const w = await mountPositionTab([movingHead('a')]);
    expect(w.findAll('[role="slider"][aria-label="Pan"], [role="slider"][aria-label="Tilt"]')).toHaveLength(2);
    expect(w.text()).not.toContain('Movement Range');
  });

  it('with the extension: pad replaces pm.xyInput and the movement range appears', async () => {
    registerExtension(panTilt, 'test');
    const w = await mountPositionTab([movingHead('b')]);
    expect(w.find('[role="slider"][aria-label="Pan / Tilt"]').exists()).toBe(true);
    expect(w.text()).toContain('Movement Range');
  });

  it('applies ranges for all selected heads as one history entry', async () => {
    registerExtension(panTilt, 'test');
    const heads = [movingHead('c'), movingHead('d')];
    const w = await mountPositionTab(heads);
    const history = useHistory();
    const before = history.version.value;

    const button = w.findAll('button').find(b => b.text().includes('Movement Range'))!;
    await button.trigger('click');
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    // Draw a box on the global pad (100×100) from (25%, 50%) to (75%, 100%).
    const pad = document.body.querySelector('[role="dialog"] .cursor-crosshair, [role="dialog"] [class*="cursor"]') as HTMLElement;
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
    pad.dispatchEvent(new PointerEvent('pointerdown', { clientX: 25, clientY: 50, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 75, clientY: 100 }));
    window.dispatchEvent(new PointerEvent('pointerup', {}));
    await nextTick();

    const apply = [...document.body.querySelectorAll('[role="dialog"] button')].find(b => b.textContent?.includes('Apply')) as HTMLElement;
    apply.click();
    await nextTick();

    expect(history.version.value).toBe(before + 1);
    for (const h of heads) {
      expect([h.channels[0]!.rangeMin, h.channels[0]!.rangeMax]).toEqual([64, 191]);
      expect([h.channels[1]!.rangeMin, h.channels[1]!.rangeMax]).toEqual([128, 255]);
    }
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
