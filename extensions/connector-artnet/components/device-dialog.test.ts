/**
 * Device dialog of the connector card: teleported overlay with label, UID
 * and firmware; the Identify flashlight (switched off on close); address and
 * personality edits that go to the device first and that an effectively
 * linked fixture follows as one undo step; Add for a device not on the
 * canvas; Mismatch resolved inline; Escape closes.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent, h as render, nextTick, ref } from 'vue';
import { DOMWrapper, mount } from '@vue/test-utils';
import { getFixture, type FixtureId } from '@pixelmapper/extension-api';
import { useHistory } from '~/components/engine/composables/use-history';
import { bumpModelTick } from '~/utils/extensions/model-tick';
import PmSelect from '~/components/pm/PmSelect.vue';
import { RDM_PID } from '../bridge/rdm-constants';
import { addDevices } from '../devices/add-devices';
import { createHarness, stubEngineGlobals, type Harness } from '../devices/testing/harness.test-support';
import DeviceDialog from './DeviceDialog.vue';

const A = '7FF0:00000001';

let h: Harness;

beforeAll(stubEngineGlobals);
afterEach(async () => {
  document.body.innerHTML = '';
  await h.dispose();
});

/** Lets the fake bridge answer, re-projects fixtures and renders. */
async function refresh() {
  await h.settle();
  bumpModelTick();
  await nextTick();
}

/** The teleported element matching `selector` (throws when missing). */
function q(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector);
  if (!el) throw new Error(`${selector} not found`);
  return new DOMWrapper(el);
}

/** One tube A (label "Left", address 1) on port 1; `linked` adds it to the canvas. */
async function tube(linked: boolean): Promise<FixtureId | null> {
  h = await createHarness(t => t.add(A, 1, { dmxStartAddress: 1 }, 'Left'));
  if (!linked) return null;
  await addDevices(h.runtime, [A]);
  return h.runtime.fixturesOfUid(A)[0]!.fixtureId;
}

/** Mounts the dialog for A with `v-model:open` in a host; records `add`. */
async function mountDialog() {
  const open = ref(true);
  const adds = ref(0);
  const Host = defineComponent({
    setup() {
      return () => render(DeviceDialog, {
        'uid': A,
        'runtime': h.runtime,
        'open': open.value,
        'onUpdate:open': (v: boolean) => { open.value = v; },
        'onAdd': () => { adds.value++; },
      });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  await refresh();
  return { wrapper, open, adds };
}

/** Types `value` into the device's address field and commits it (Enter). */
async function commitAddress(value: string) {
  const input = q('[data-rdm-address] input');
  await input.setValue(value);
  await input.trigger('keyup', { key: 'Enter' });
}

/** RDM SETs of `pid` received by the simulated tubes since index `from`. */
function setsOf(pid: number, from = 0) {
  return h.tubes.sets.slice(from).filter(s => s.pid === pid).map(s => s.value);
}

describe('DeviceDialog', () => {
  it('opens teleported as an overlay with label, model, UID and firmware', async () => {
    await tube(true);
    const { wrapper } = await mountDialog();
    const dialog = q('[data-overlay-root] [role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(q(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Left');
    expect(q('[data-device-model]').text()).toBe('XBAR500 LED Tube');
    expect(q('[data-rdm-uid]').text()).toBe(A);
    expect(q('[data-rdm-firmware]').text()).toBe('0.5.0');
    expect(q('[data-rdm-kind]').text()).toBe('Connected');
    expect(wrapper.find('[data-overlay-root]').exists()).toBe(false); // not inside the host's element
    wrapper.unmount();
  });

  it('toggles Identify with the flashlight and switches it off on close', async () => {
    await tube(true);
    const { wrapper, open } = await mountDialog();
    await q('[data-identify-button]').trigger('click');
    await refresh();
    expect(h.tubes.devices.get(A)!.identify).toBe(true);
    expect(q('[data-identify-button]').attributes('aria-pressed')).toBe('true');

    await q('[data-close]').trigger('click');
    await refresh();
    expect(open.value).toBe(false);
    expect(document.body.querySelector('[data-device-dialog]')).toBeNull();
    expect(h.tubes.devices.get(A)!.identify).toBe(false);
    wrapper.unmount();
  });

  it('sends a new address to the device; the linked fixture follows as one undo step', async () => {
    const a = (await tube(true))!;
    const { wrapper } = await mountDialog();
    const n = h.tubes.sets.length;
    await commitAddress('30');
    await refresh();
    expect(setsOf(RDM_PID.DMX_START_ADDRESS, n)).toEqual([30]);
    expect(h.tubes.devices.get(A)!.info.dmxStartAddress).toBe(30);
    expect(getFixture(a)!.localAddress).toBe(30);
    expect(useHistory().lastDescription.value).toBe('Take patch from device');

    useHistory().undo();
    await refresh();
    expect(getFixture(a)!.localAddress).toBe(1);
    wrapper.unmount();
  });

  it('sends a new personality; the linked fixture takes the matching mode', async () => {
    const a = (await tube(true))!;
    const { wrapper } = await mountDialog();
    const select = wrapper.findComponent(PmSelect);
    expect(select.props('options').map((o: { label: string }) => o.label)).toEqual(['1 · 12 ch', '2 · 3 ch', '3 · 4 ch', '4 · 13 ch']);
    expect(select.props('modelValue')).toBe('1');
    const n = h.tubes.sets.length;
    select.vm.$emit('update:modelValue', '2');
    await refresh();
    await refresh();
    expect(setsOf(RDM_PID.DMX_PERSONALITY, n)).toEqual([2]);
    expect(h.tubes.devices.get(A)!.info.currentPersonality).toBe(2);
    expect(getFixture(a)).toMatchObject({ localAddress: 1, source: { modeIndex: 1 } });
    expect(wrapper.findComponent(PmSelect).props('modelValue')).toBe('2');
    wrapper.unmount();
  });

  it('offers Add for a device that is not on the canvas', async () => {
    await tube(false);
    const { wrapper, adds } = await mountDialog();
    expect(q('[data-rdm-status]').text()).toBe('Use Add to put it on the canvas with its current address and mode.');
    expect(document.body.querySelector('[data-unlink]')).toBeNull();
    await q('[data-add-device]').trigger('click');
    expect(adds.value).toBe(1);
    // Without a fixture an address edit only changes the device.
    await commitAddress('40');
    await refresh();
    expect(h.tubes.devices.get(A)!.info.dmxStartAddress).toBe(40);
    expect(h.runtime.fixturesOfUid(A)).toEqual([]);
    wrapper.unmount();
  });

  it('shows Write / Take on Mismatch; Take from device resolves it', async () => {
    const a = (await tube(true))!;
    const { wrapper } = await mountDialog();
    h.tubes.changeFromPanel(A, { dmxStartAddress: 50 });
    await refresh();
    expect(q('[data-rdm-kind]').text()).toBe('Mismatch');
    expect(q('[data-rdm-status]').text()).toBe('Device address 50, fixture 1');
    expect(document.body.querySelector('[data-write-device]')).not.toBeNull();
    await q('[data-take-device]').trigger('click');
    await refresh();
    expect(getFixture(a)!.localAddress).toBe(50);
    expect(q('[data-rdm-kind]').text()).toBe('Connected');
    expect(document.body.querySelector('[data-rdm-mismatch]')).toBeNull();
    wrapper.unmount();
  });

  it('closes on Escape and on a click on the backdrop', async () => {
    await tube(true);
    const { wrapper, open } = await mountDialog();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(open.value).toBe(false);
    expect(document.body.querySelector('[data-device-dialog]')).toBeNull();

    open.value = true;
    await nextTick();
    await q('[data-device-dialog]').trigger('click');
    expect(open.value).toBe(false);
    wrapper.unmount();
  });
});
