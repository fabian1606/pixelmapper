/**
 * RDM devices in the Art-Net card's port blocks (WP13; logic of plan M6.1):
 * each port lists its own devices, the header line counts them and flags
 * conflicts, Add all on this port / Add all as one undo step each, Assign
 * free address, the TodNak hint, the list hidden while RDM is off on the
 * port, Identify (flashlight) switched off when the card closes, Rediscover
 * of one port, and a row click opening the device dialog.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { listFixtures } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import { RDM_PID } from '../bridge/rdm-constants';
import { makeTodNak } from '../bridge/testing/fixtures';
import { createHarness, stubEngineGlobals, type Harness } from '../devices/testing/harness.test-support';
import NodeCard from './NodeCard.vue';

const A = '7FF0:00000001';
const B = '7FF0:00000002';
const C = '7FF0:00000003';

let h: Harness;

beforeAll(stubEngineGlobals);
afterEach(async () => {
  document.body.innerHTML = '';
  await h.dispose();
});

/** Mounts the card of the harness node. */
function mountCard() {
  return mount(NodeCard, { props: { connector: h.connector, runtime: h.runtime }, attachTo: document.body });
}

/** Lets the bridge and the model tick settle. */
async function refresh() {
  await h.settle();
  bumpModelTick();
  await nextTick();
}

/** Block of the port at BindIndex `bind`. */
const port = (w: VueWrapper, bind: number) => w.find(`[data-port="${bind}.0"]`);
/** Opens the block of port `bind`. */
async function openPort(w: VueWrapper, bind: number) {
  await w.find(`[data-section="port:${bind}.0"] > div > [data-section-toggle]`).trigger('click');
  await refresh();
}
/** Clicks a button and lets everything settle. */
async function click(el: { trigger: (e: string) => Promise<void> }) {
  await el.trigger('click');
  await refresh();
}

describe('NodeCard devices', () => {
  it('lists the devices per port and adds them per port or all at once', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 }, 'Left');
      t.add(B, 2, { dmxStartAddress: 7, currentPersonality: 3 });
      t.add(C, 2, { dmxStartAddress: 20 });
    });
    const w = mountCard();
    await refresh();
    expect(port(w, 1).find('[data-port-count]').text()).toBe('1 device');
    expect(port(w, 2).find('[data-port-count]').text()).toBe('2 devices');

    await openPort(w, 1);
    const list = port(w, 1).find('[data-port-devices]');
    expect(list.text()).toContain('U1.1');
    expect(list.text()).toContain('Left · XBAR500 LED Tube');
    expect(list.findAll('[data-device]')).toHaveLength(1);
    await click(list.find('[data-add-port]'));
    expect(listFixtures()).toHaveLength(1);
    expect(port(w, 1).find('[data-device-state]').text()).toBe('linked');

    // The toolbar adds what is left on every port, as one undo step.
    await click(w.find('[data-add-all]'));
    expect(listFixtures()).toHaveLength(3);
    expect(useHistory().lastDescription.value).toBe('Add 2 devices');
    expect(w.text()).toContain('2 of 2 devices added');
    w.unmount();
  });

  it('flags a conflict in the header line and assigns a free address', async () => {
    h = await createHarness((t) => {
      t.add(A, 1, { dmxStartAddress: 1 });
      t.add(B, 1, { dmxStartAddress: 5 });
    });
    const w = mountCard();
    await refresh();
    expect(port(w, 1).find('[data-port-problems]').text()).toBe('2 conflicts');
    await openPort(w, 1);
    await click(port(w, 1).findAll('[data-assign]')[1]!);
    expect(h.tubes.devices.get(B)!.info.dmxStartAddress).toBe(13);
    expect(port(w, 1).text()).toContain('Moved to address 13');
    expect(port(w, 1).find('[data-port-problems]').exists()).toBe(false);
    w.unmount();
  });

  it('explains empty ports and ports without RDM', async () => {
    h = await createHarness(t => t.add(A, 1));
    const w = mountCard();
    await refresh();
    await openPort(w, 2);
    expect(port(w, 2).find('[data-no-devices]').text()).toBe('No RDM devices found on this port. Connected fixtures without RDM still receive DMX.');
    h.backend.emit({ type: 'tod', ...makeTodNak(h.tubes.node.nodeId, 2) });
    await refresh();
    expect(port(w, 2).find('[data-no-rdm]').text()).toBe('RDM is not available on this port (off, input, or RDM disabled).');
    expect(port(w, 2).find('[data-no-devices]').exists()).toBe(false);
    w.unmount();
  });

  it('hides the device list while RDM is off on the port', async () => {
    h = await createHarness(t => t.add(A, 1));
    const w = mountCard();
    await refresh();
    await openPort(w, 1);
    expect(port(w, 1).find('[data-port-devices]').exists()).toBe(true);
    const node = h.tubes.node;
    h.backend.emit({ type: 'node', node: { ...node, ports: node.ports.map(p => (p.port.bind === 1 ? { ...p, output: { ...p.output, rdm: false } } : p)) } });
    await refresh();
    expect(port(w, 1).find('[data-port-devices]').exists()).toBe(false);
    expect(port(w, 1).find('[data-port-count]').exists()).toBe(false);
    w.unmount();
  });

  it('identifies with the flashlight, switches it off when the card closes, and rediscovers one port', async () => {
    h = await createHarness(t => t.add(A, 1));
    const w = mountCard();
    await refresh();
    await openPort(w, 1);
    const identify = port(w, 1).find('[data-device] [data-identify-button]');
    expect(identify.attributes('title')).toBe('Identify');
    await click(identify);
    expect(h.tubes.devices.get(A)!.identify).toBe(true);
    expect(port(w, 1).find('[data-device] [data-identify-button]').attributes('aria-pressed')).toBe('true');
    expect(document.body.querySelector('[data-device-dialog]')).toBeNull(); // the button does not open the dialog

    await click(port(w, 1).find('[data-rediscover]'));
    expect(h.backend.requests.filter(r => r.type === 'todControl').map(r => r.args)).toEqual([
      { nodeId: h.tubes.node.nodeId, port: { bind: 1, index: 0 }, action: 'flush' },
    ]);
    w.unmount();
    await h.settle();
    expect(h.tubes.devices.get(A)!.identify).toBe(false);
    expect(h.tubes.sets.filter(s => s.pid === RDM_PID.IDENTIFY_DEVICE).map(s => s.value)).toEqual([true, false]);
  });

  it('opens the device dialog from a row', async () => {
    h = await createHarness(t => t.add(A, 1, { dmxStartAddress: 1 }, 'Left'));
    const w = mountCard();
    await refresh();
    await openPort(w, 1);
    await click(port(w, 1).find('[data-device]'));
    await flushPromises();
    const dialog = document.body.querySelector('[data-device-dialog]');
    expect(dialog?.hasAttribute('data-overlay-root')).toBe(true);
    expect(dialog?.textContent).toContain('Left');
    w.unmount();
  });
});
