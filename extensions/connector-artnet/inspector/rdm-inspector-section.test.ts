/**
 * RDM section of the fixture inspector (plan M7.2, D18): status, UID, node
 * port and firmware of the linked device, Identify with auto-off, the
 * DEVICE_LABEL written and read back, Unlink / Re-link as one undo step,
 * discovery held while mounted, and the slot only for linked fixtures.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h as render, nextTick, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { getFixture, type FixtureId } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { provideScope } from '~/composables/extensions/provide-scope';
import { fixtureView } from '~/utils/extensions/scope-views';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { findFixtureInTree } from '~/utils/engine/scene-tree';
import type { SceneNode } from '~/utils/engine/core/group';
import manifest from '../extension';
import { artNetDiscoveryDemand } from '../bridge/shared';
import { addDevices } from '../devices/add-devices';
import { readLink } from '../devices/link';
import { createHarness, stubEngineGlobals, type Harness } from '../devices/testing/harness.test-support';
import RdmInspectorSection from './RdmInspectorSection.vue';

const A = '7FF0:00000001';
const B = '7FF0:00000002';

let h: Harness;

beforeAll(stubEngineGlobals);
afterEach(async () => {
  document.body.innerHTML = '';
  await h.dispose();
});

/** Re-projects the scope after model changes, then renders. */
async function refresh() {
  await h.settle();
  bumpModelTick();
  await nextTick();
}

/** Mounts the section in an inspector scope showing `selected` (null = nothing / multi-selection). */
function mountSection(initial: FixtureId | null) {
  const selected = shallowRef<FixtureId | null>(initial);
  const Inspector = defineComponent({
    setup() {
      provideScope('fixture', () => {
        const f = selected.value ? findFixtureInTree(useEngineStore().sceneNodes as SceneNode[], selected.value) : null;
        return f ? fixtureView(f) : undefined;
      });
      return () => render(RdmInspectorSection, { runtime: h.runtime });
    },
  });
  return { wrapper: mount(Inspector, { attachTo: document.body }), selected };
}

/** Two linked tubes A (address 1) and B (address 13) on port 1. */
async function twoTubes(): Promise<[FixtureId, FixtureId]> {
  h = await createHarness((t) => {
    t.add(A, 1, { dmxStartAddress: 1 }, 'Left');
    t.add(B, 1, { dmxStartAddress: 13 });
  });
  await addDevices(h.runtime, [A, B]);
  return [h.runtime.fixturesOfUid(A)[0]!.fixtureId, h.runtime.fixturesOfUid(B)[0]!.fixtureId];
}

describe('RdmInspectorSection', () => {
  it('shows status, UID, node port and firmware, and holds discovery while mounted', async () => {
    const [a] = await twoTubes();
    const demand = artNetDiscoveryDemand();
    const { wrapper } = mountSection(a);
    await refresh();
    expect(artNetDiscoveryDemand()).toBe(demand + 1);
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Connected');
    expect(wrapper.find('[data-rdm-status]').text()).toBe('Address and mode changes are sent to the device.');
    expect(wrapper.find('[data-rdm-uid]').text()).toBe(A);
    expect(wrapper.find('[data-rdm-port]').text()).toBe('PM Node port 1 · U1');
    expect(wrapper.find('[data-rdm-firmware]').text()).toBe('0.5.0');
    expect((wrapper.find('[data-rdm-label] input').element as HTMLInputElement).value).toBe('Left');
    expect(wrapper.find('[data-open-firmware]').exists()).toBe(true); // our tube: firmware can be updated
    wrapper.unmount();
    expect(artNetDiscoveryDemand()).toBe(demand);
  });

  it('switches Identify and turns it off when the selection changes or the section closes', async () => {
    const [a, b] = await twoTubes();
    const { wrapper, selected } = mountSection(a);
    await refresh();
    await wrapper.find('[data-rdm-identify] [role="switch"]').trigger('click');
    await refresh();
    expect(h.tubes.devices.get(A)!.identify).toBe(true);
    expect(wrapper.find('[data-rdm-identify] [role="switch"]').attributes('aria-checked')).toBe('true');

    selected.value = b;
    await refresh();
    expect(h.tubes.devices.get(A)!.identify).toBe(false);
    await wrapper.find('[data-rdm-identify] [role="switch"]').trigger('click');
    await refresh();
    expect(h.tubes.devices.get(B)!.identify).toBe(true);

    wrapper.unmount();
    await refresh();
    expect(h.tubes.devices.get(B)!.identify).toBe(false);
  });

  it('writes DEVICE_LABEL and shows what the device reads back', async () => {
    const [a] = await twoTubes();
    const { wrapper } = mountSection(a);
    await refresh();
    const input = wrapper.find('[data-rdm-label] input');
    await input.setValue('Stage left');
    await input.trigger('change');
    await refresh();
    expect(h.tubes.devices.get(A)!.label).toBe('Stage left');
    expect(h.runtime.store.get(A)!.description?.deviceLabel).toBe('Stage left');
    expect((wrapper.find('[data-rdm-label] input').element as HTMLInputElement).value).toBe('Stage left');
    wrapper.unmount();
  });

  it('unlinks and re-links (back into the port universe) as one undo step each, sending nothing', async () => {
    const [a] = await twoTubes();
    const { wrapper } = mountSection(a);
    await refresh();
    const sets = h.tubes.sets.length;

    await wrapper.find('[data-unlink]').trigger('click');
    await refresh();
    expect(readLink(getFixture(a)!.extensionData as never)?.state).toBe('unlinked');
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Unlinked');
    expect(wrapper.find('[data-rdm-status]').text()).toBe('Unlinked — changes are not sent to the device');

    // The user moves it to U2 meanwhile; Re-link moves it back to U1, same address.
    h.runAsUser(h.runtime.api.commands.setStartAddress({ fixtureId: a, startAddress: 512 + 5 }));
    await refresh();
    await wrapper.find('[data-relink]').trigger('click');
    await refresh();
    expect(getFixture(a)!.startAddress).toBe(5);
    expect(readLink(getFixture(a)!.extensionData as never)?.state).toBe('linked');
    expect(wrapper.find('[data-rdm-badge]').text()).toBe('Mismatch'); // the device is still at 1
    expect(h.tubes.sets.length).toBe(sets); // nothing was written to the device

    // One undo step brings back U2 and `unlinked`.
    useHistory().undo();
    await refresh();
    expect(getFixture(a)!.startAddress).toBe(517);
    expect(readLink(getFixture(a)!.extensionData as never)?.state).toBe('unlinked');
    wrapper.unmount();
  });

  it('is contributed to properties:after only for fixtures with an RDM link', async () => {
    const [a] = await twoTubes();
    const slot = manifest.contributes!.slots!.find(s => s.slot === 'properties:after')!;
    expect(slot.component).toBe(RdmInspectorSection);
    expect(slot.when!({ fixture: getFixture(a) as never })).toBe(true);
    expect(slot.when!({ fixture: { ...getFixture(a)!, extensionData: undefined } as never })).toBe(false);
    // Multi-selection: the inspector provides no `fixture` scope.
    expect(slot.when!({})).toBe(false);
    const { wrapper } = mountSection(null);
    await refresh();
    expect(wrapper.find('[data-rdm-inspector]').exists()).toBe(false);
    wrapper.unmount();
  });
});
