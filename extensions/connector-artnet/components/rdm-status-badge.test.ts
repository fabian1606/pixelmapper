/**
 * RDM status badge (plan M6.7, D15): Connected / Mismatch / Offline /
 * Unlinked in the fixture row, tooltip with UID, firmware and last seen,
 * and the Mismatch popover (Write to device / Take from device) as a
 * floating overlay that does not close the sidebar.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h as render, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { getFixture, type FixtureId } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { provideScope } from '~/composables/extensions/provide-scope';
import { fixtureView } from '~/utils/extensions/scope-views';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { findFixtureInTree } from '~/utils/engine/scene-tree';
import type { SceneNode } from '~/utils/engine/core/group';
import { FLOATING_OVERLAY_SELECTORS, isInFloatingOverlay } from '~/utils/floating-overlay';
import manifest from '../extension';
import { addDevices } from '../devices/add-devices';
import { createHarness, stubEngineGlobals, type Harness } from '../devices/testing/harness.test-support';
import RdmStatusBadge from './RdmStatusBadge.vue';

const A = '7FF0:00000001';

let h: Harness;

beforeAll(stubEngineGlobals);
afterEach(async () => {
  document.body.innerHTML = '';
  await h.dispose();
});

/** Mounts the badge in a fixture row scope of `fixtureId`. */
function mountBadge(fixtureId: FixtureId) {
  const Row = defineComponent({
    setup() {
      provideScope('fixture', () => {
        const f = findFixtureInTree(useEngineStore().sceneNodes as SceneNode[], fixtureId);
        return f ? fixtureView(f) : undefined;
      });
      return () => render(RdmStatusBadge, { runtime: h.runtime });
    },
  });
  return mount(Row, { attachTo: document.body });
}

/** Re-projects the scope after model changes, then renders. */
async function refresh() {
  await h.settle();
  bumpModelTick();
  await nextTick();
}

/** The linked tube's fixture id. */
async function linkedTube(): Promise<FixtureId> {
  h = await createHarness(t => t.add(A, 1, { dmxStartAddress: 1 }));
  await addDevices(h.runtime, [A]);
  return h.runtime.fixturesOfUid(A)[0]!.fixtureId;
}

describe('RdmStatusBadge', () => {
  it('shows Connected with UID, firmware and last seen in the tooltip', async () => {
    const id = await linkedTube();
    const wrapper = mountBadge(id);
    await refresh();
    const badge = wrapper.find('[data-rdm-badge]');
    expect(badge.text()).toBe('Connected');
    expect(badge.attributes('title')).toMatch(/UID 7FF0:00000001 · PM Node port 1/);
    expect(badge.attributes('title')).toMatch(/Firmware 0\.5\.0/);
    expect(badge.attributes('title')).toMatch(/Last seen /);
    wrapper.unmount();
  });

  it('resolves a Mismatch from the popover (take, then write)', async () => {
    const id = await linkedTube();
    const wrapper = mountBadge(id);
    h.tubes.changeFromPanel(A, { dmxStartAddress: 50 });
    await refresh();
    const badge = wrapper.find('[data-rdm-badge]');
    expect(badge.text()).toBe('Mismatch');
    expect(badge.attributes('title')).toMatch(/Device address 50, fixture 1/);

    await badge.trigger('click');
    const popover = document.body.querySelector('[role="dialog"]')!;
    expect(popover.hasAttribute('data-overlay-root')).toBe(true);
    expect(FLOATING_OVERLAY_SELECTORS).toContain('[data-overlay-root]');
    expect(isInFloatingOverlay(popover.querySelector('button'))).toBe(true); // the sidebar ignores clicks here
    const take = [...popover.querySelectorAll('button')].find(b => b.textContent?.includes('Take from device'))!;
    take.click();
    await refresh();
    expect(getFixture(id)!.localAddress).toBe(50);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Connected');

    h.tubes.changeFromPanel(A, { dmxStartAddress: 7 });
    await refresh();
    await wrapper.find('[data-rdm-badge]').trigger('click');
    const write = [...document.body.querySelectorAll('[role="dialog"] button')].find(b => b.textContent?.includes('Write to device')) as HTMLButtonElement;
    write.click();
    await refresh();
    expect(h.tubes.devices.get(A)!.info.dmxStartAddress).toBe(50);
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Connected');
    wrapper.unmount();
  });

  it('shows Offline and Unlinked', async () => {
    const id = await linkedTube();
    const wrapper = mountBadge(id);
    h.tubes.unplug(A);
    await refresh();
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Offline');
    await wrapper.find('[data-rdm-badge]').trigger('click');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull(); // only Mismatch opens the popover

    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: id, startAddress: 600 }));
    await refresh();
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Unlinked');
    wrapper.unmount();
  });

  it('is contributed only for fixtures with an RDM link', async () => {
    const id = await linkedTube();
    const slot = manifest.contributes!.slots!.find(s => s.slot === 'scene/fixture:badges')!;
    expect(slot.when!({ fixture: getFixture(id) as never })).toBe(true);
    expect(slot.when!({ fixture: { ...getFixture(id)!, extensionData: undefined } as never })).toBe(false);
  });
});
