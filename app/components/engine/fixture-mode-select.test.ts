/**
 * Inspector Mode select (plan M4.3): lists the definition's modes, switches
 * the mode undoably (keeping the fixture's links and position) and respects
 * the fixture change guards (M4.5).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { OflFixture } from '~/utils/ofl/types';
import type { SceneNode } from '~/utils/engine/core/group';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from './composables/use-history';
import { saveCustomFixture, customFixtureKey } from '~/utils/fixture-definitions/custom-fixtures';
import { useFreshCustomFixtureLibrary } from '~/utils/fixture-definitions/custom-fixtures.test-support';
import { resolveFixtureDefinition, createFixtureFromDefinition } from '~/utils/fixture-definitions/resolve-definition';
import { clearFixtureChangeGuards, registerFixtureChangeGuard } from '~/utils/extensions/fixture-change-guard';
import xbar500 from '~/utils/fixture-definitions/__fixtures__/xbar500-custom.json';
import PmSelect from '~/components/pm/PmSelect.vue';

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
});

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  await useFreshCustomFixtureLibrary();
});

afterEach(() => clearFixtureChangeGuards());

/** Adds an XBAR500 tube (mode 0) with extension data to the store's scene. */
async function addTube() {
  const key = customFixtureKey((await saveCustomFixture(xbar500 as unknown as OflFixture))!);
  const fixture = createFixtureFromDefinition((await resolveFixtureDefinition(key))!, 0);
  fixture.id = 'tube-1';
  fixture.fixturePosition = { x: 0.3, y: 0.4 };
  fixture.extensionData = { 'some-ext': { link: 'uid-1' } };
  (useEngineStore().sceneNodes as SceneNode[]).push(fixture);
  return fixture;
}

/** Mounts the select for a fixture and waits for its modes. */
async function mountSelect(fixture: Awaited<ReturnType<typeof addTube>>) {
  const FixtureModeSelect = (await import('./FixtureModeSelect.vue')).default;
  const w = mount(FixtureModeSelect, { props: { fixture } });
  await flushPromises();
  return w;
}

describe('FixtureModeSelect', () => {
  it('lists the modes and switches undoably, keeping links and position', async () => {
    const tube = await addTube();
    const w = await mountSelect(tube);
    const select = w.findComponent(PmSelect);
    expect(select.props('options').map((o: { label: string }) => o.label)).toEqual([
      '4x RGB (12 ch) (12 ch)', 'RGB (3 ch) (3 ch)', 'RGB + Dimmer (4 ch) (4 ch)', '4x RGB + Dimmer (13 ch) (13 ch)',
    ]);
    expect(select.props('modelValue')).toBe('0');

    select.vm.$emit('update:modelValue', '2');
    await flushPromises();
    expect(tube.channels).toHaveLength(4);
    expect(tube.source?.modeIndex).toBe(2);
    expect(tube.fixturePosition).toEqual({ x: 0.3, y: 0.4 });
    expect(tube.extensionData).toEqual({ 'some-ext': { link: 'uid-1' } });

    useHistory().undo();
    expect(tube.channels).toHaveLength(12);
    expect(tube.source?.modeIndex).toBe(0);
    w.unmount();
  });

  it('does not switch when a guard denies', async () => {
    const tube = await addTube();
    registerFixtureChangeGuard(c => (c.after.modeIndex !== c.before.modeIndex ? { action: 'deny', message: 'No.' } : undefined));
    const w = await mountSelect(tube);
    w.findComponent(PmSelect).vm.$emit('update:modelValue', '1');
    await flushPromises();
    expect(tube.channels).toHaveLength(12);
    expect(tube.source?.modeIndex).toBe(0);
    w.unmount();
  });
});
