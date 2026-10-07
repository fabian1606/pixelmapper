/**
 * Plan P2.3: live widget registry — core types, extension widget types,
 * legacy type mapping and the placeholder for unknown types.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineExtension, useScope } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { resetReplacementState } from '~/utils/extensions/replacements';
import { listWidgetTypes, resolveWidgetType } from './widget-registry';
import { defaultLiveWidget, normalizePageWidgetTypes, type LivePage, type LiveWidget } from './types';
import LiveWidgetView from '~/components/live/LiveWidget.vue';

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

enableAutoUnmount(afterEach);

/** An extension contributing a `meter` widget that shows its scope label. */
const Meter = defineComponent({
  setup() {
    const w = useScope('liveWidget');
    return () => h('i', { class: 'meter' }, w.value?.label ?? '');
  },
});
const meterExtension = defineExtension({
  id: 'meters', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Meters', description: 'Level meters.',
  contributes: {
    liveWidgets: [{ type: 'meters/level', label: 'Level', icon: 'gauge', component: Meter, defaultConfig: () => ({ peak: true }), defaultSize: { w: 2, h: 5 } }],
  },
});

/** Mounts a live widget. */
function mountWidget(widget: LiveWidget) {
  return mount(LiveWidgetView, { props: { widget, pageId: 'p', gridSize: 32, editMode: false, canvasScale: 1 } });
}

describe('live widget registry', () => {
  it('lists the deduplicated core types', () => {
    expect(listWidgetTypes().filter(t => t.addable).map(t => t.type)).toEqual([
      'button', 'slider', 'xy', 'label', 'fixture-preview', 'color', 'beat',
    ]);
    expect(resolveWidgetType('xy-pad')).toBeNull();
  });

  it('maps legacy widget type names', () => {
    const page = { widgets: [{ type: 'xy-pad' }, { type: 'color-wheel' }, { type: 'slider' }] } as unknown as LivePage;
    expect(normalizePageWidgetTypes(page).widgets.map(w => w.type)).toEqual(['xy', 'color', 'slider']);
  });

  it('adds extension widget types and renders them with the liveWidget scope', () => {
    registerExtension(meterExtension, 'test');
    const info = resolveWidgetType('meters/level')!;
    expect(info.extensionId).toBe('meters');
    expect(info.defaultSize).toEqual([2, 5]);

    const widget = { ...defaultLiveWidget('meters/level', 0, 0, info.defaultSize), label: 'Main' };
    expect(mountWidget(widget).find('i.meter').text()).toBe('Main');
  });

  it('renders a placeholder for widgets of a missing extension', () => {
    const w = mountWidget(defaultLiveWidget('meters/level'));
    expect(w.text()).toContain('Widget from extension “meters” not installed');
  });

  it('renders the core xy and color widgets through pm.* inputs', () => {
    expect(mountWidget(defaultLiveWidget('xy')).findAll('[role="slider"]')).toHaveLength(2);
    expect(mountWidget(defaultLiveWidget('color')).find('input[aria-label="Hex color"]').exists()).toBe(true);
  });
});
