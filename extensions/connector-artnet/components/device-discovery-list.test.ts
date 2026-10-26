/**
 * Device list in the node card (plan M6.1): rows with address, label,
 * model, personality, firmware and state; Add all as one undo step; Assign
 * free address on a conflict; Identify switched off when the card closes;
 * Rediscover = ArtTodControl flush; ports without RDM (TodNak) are named.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { listFixtures } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { RDM_PID } from '../bridge/rdm-constants';
import { makeTodNak } from '../bridge/testing/fixtures';
import { createHarness, stubEngineGlobals, type Harness } from '../devices/testing/harness.test-support';
import DeviceDiscoveryList from './DeviceDiscoveryList.vue';

const A = '7FF0:00000001';
const B = '7FF0:00000002';

let h: Harness;

beforeAll(stubEngineGlobals);
afterEach(async () => h.dispose());

/** Mounts the list of the harness node. */
function mountList() {
  return mount(DeviceDiscoveryList, { props: { connector: h.connector, runtime: h.runtime } });
}

/** Clicks the button with `text` (in `scope` when given). */
async function click(wrapper: ReturnType<typeof mountList>, text: string, index = 0) {
  const buttons = wrapper.findAll('button').filter(b => b.text() === text);
  await buttons[index]!.trigger('click');
  await h.settle();
  bumpModelTick();
  await nextTick();
}

describe('DeviceDiscoveryList', () => {
  it('lists the devices and adds them all as one undo step', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 }, 'Left');
      t.add(B, 2, { dmxStartAddress: 7, currentPersonality: 3 });
    });
    const wrapper = mountList();
    await nextTick();
    const text = wrapper.text();
    expect(text).toContain('2 found');
    expect(text).toContain('U1.1');
    expect(text).toContain('Left · XBAR500 LED Tube');
    expect(text).toContain('U2.7');
    expect(text).toContain('3/4 · 4 ch');
    expect(text).toContain('FW 0.5.0');
    expect(wrapper.findAll('span').filter(s => s.text() === 'new')).toHaveLength(2);

    await click(wrapper, 'Add all');
    expect(listFixtures()).toHaveLength(2);
    expect(useHistory().lastDescription.value).toBe('Add 2 devices');
    expect(wrapper.text()).toContain('2 of 2 devices added');
    expect(wrapper.findAll('span').filter(s => s.text() === 'linked')).toHaveLength(2);
    expect(wrapper.findAll('button').filter(b => b.text() === 'Add')).toHaveLength(0);
    wrapper.unmount();
  });

  it('flags a conflict and assigns a free address', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 });
      t.add(B, 1, { dmxStartAddress: 5 });
    });
    const wrapper = mountList();
    await nextTick();
    expect(wrapper.findAll('span').filter(s => s.text() === 'conflict')).toHaveLength(2);
    await click(wrapper, 'Assign free address', 1);
    expect(h.tubes.devices.get(B)!.info.dmxStartAddress).toBe(13);
    expect(wrapper.text()).toContain('Moved to address 13');
    expect(wrapper.findAll('span').filter(s => s.text() === 'conflict')).toHaveLength(0);
    wrapper.unmount();
  });

  it('says that RDM is not available on a port that answers TodNak', async () => {
    h = await createHarness(t => t.add(A, 3));
    const wrapper = mountList();
    await nextTick();
    expect(wrapper.text()).toContain('1 found');
    expect(wrapper.find('[data-no-rdm]').exists()).toBe(false);
    h.backend.emit({ type: 'tod', ...makeTodNak(h.tubes.node.nodeId, 3) });
    h.backend.emit({ type: 'tod', ...makeTodNak(h.tubes.node.nodeId, 4) });
    await h.settle();
    await nextTick();
    expect(wrapper.text()).toContain('0 found');
    expect(wrapper.text()).not.toContain('No RDM devices found');
    expect(wrapper.find('[data-no-rdm]').text()).toBe('Port 3, Port 4: RDM is not available on these ports (off, input, or RDM disabled).');
    wrapper.unmount();
  });

  it('switches Identify off when the card closes and rediscovers', async () => {
    h = await createHarness(t => t.add(A, 1));
    const wrapper = mountList();
    await nextTick();
    await click(wrapper, 'Identify');
    expect(h.tubes.devices.get(A)!.identify).toBe(true);
    await click(wrapper, 'Rediscover');
    expect(h.backend.requests.filter(r => r.type === 'todControl').map(r => (r.args as { action: string }).action)).toEqual(['flush', 'flush', 'flush', 'flush']);
    wrapper.unmount();
    await h.settle();
    expect(h.tubes.devices.get(A)!.identify).toBe(false);
    expect(h.tubes.sets.filter(s => s.pid === RDM_PID.IDENTIFY_DEVICE).map(s => s.value)).toEqual([true, false]);
  });
});
