/**
 * Device section against `FakeArtNetBackend` (plan M7.3): names written
 * with ArtAddress and shown from the node event, byte limits, identify with
 * auto-off on unmount, firmware read-only, DEVICE_LABEL only where it is a
 * setting of its own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { makeStatus } from '../bridge/testing/fixtures';
import { makeDescription } from '../rdm/parameter-form/testing/fixtures';
import NodeDeviceSection from './NodeDeviceSection.vue';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from './testing/harness';

let h: NodeHarness;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  installHost();
  h = await setupNode();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  uninstallHost();
});

/** Mounts the section for `nodeId` and waits for the description. */
async function mountSection(nodeId = NODE_UID) {
  wrapper = mount(NodeDeviceSection, { props: { nodeId, backend: h.backend, directory: h.directory } });
  await flushPromises();
  return wrapper;
}

const nameInput = (w: VueWrapper, key: 'shortName' | 'longName') => w.find(`[data-field="${key}"] input`);
const value = (el: { element: Element }) => (el.element as HTMLInputElement).value;

/** Types into an input (input event only; `setValue` would also commit with `change`). */
async function type(el: ReturnType<VueWrapper['find']>, text: string) {
  (el.element as HTMLInputElement).value = text;
  await el.trigger('input');
}

describe('NodeDeviceSection', () => {
  it('writes a name on commit and shows it with the node event', async () => {
    const w = await mountSection();
    expect(value(nameInput(w, 'shortName'))).toBe('PM Node');
    await type(nameInput(w, 'shortName'), 'Stage left');
    expect(h.argsOf('artAddress')).toEqual([]); // typing sends nothing
    await nameInput(w, 'shortName').trigger('change');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, shortName: 'Stage left' }]);
    expect(value(nameInput(w, 'shortName'))).toBe('PM Node'); // not what was sent
    h.update({ shortName: 'Stage left' });
    await flushPromises();
    expect(value(nameInput(w, 'shortName'))).toBe('Stage left');
  });

  it('refuses names beyond the byte limit', async () => {
    const w = await mountSection();
    await nameInput(w, 'shortName').setValue('x'.repeat(18));
    await nameInput(w, 'shortName').trigger('change');
    await nameInput(w, 'longName').setValue('');
    await nameInput(w, 'longName').trigger('change');
    await flushPromises();
    expect(w.text()).toContain('At most 17 characters (18)');
    expect(w.text()).toContain('Enter a name');
    expect(h.argsOf('artAddress')).toEqual([]);
    expect(nameInput(w, 'shortName').attributes('maxlength')).toBe('17');
    expect(nameInput(w, 'longName').attributes('maxlength')).toBe('63');
  });

  it('identifies the node and switches identify off when it closes', async () => {
    const w = await mountSection();
    const toggle = () => w.find('[data-field="identify"] [data-pm="toggle"]');
    await toggle().trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, indicator: 'locate' }]);
    expect(toggle().attributes('aria-checked')).toBe('false'); // until the node reports it
    h.update({ status: makeStatus({ indicator: 'locate' }) });
    await flushPromises();
    expect(toggle().attributes('aria-checked')).toBe('true');
    w.unmount();
    wrapper = null;
    expect(h.argsOf('artAddress').at(-1)).toEqual({ nodeId: NODE_UID, indicator: 'normal' });
  });

  it('leaves identify alone when it was started elsewhere', async () => {
    h.update({ status: makeStatus({ indicator: 'locate' }) });
    const w = await mountSection();
    w.unmount();
    wrapper = null;
    expect(h.argsOf('artAddress')).toEqual([]);
  });

  it('shows firmware and identity read-only, without DEVICE_LABEL on the Pixelmapper Node', async () => {
    const w = await mountSection();
    const info = w.find('[data-field="info"]').text();
    expect(info).toContain('1.0 · 1.2.0');
    expect(info).toContain('boot 3');
    expect(info).toContain('UID 7FF0:8A1B2C3D');
    expect(w.find('[data-field="deviceLabel"]').exists()).toBe(false); // = short name (contract §6.3)
  });

  it('edits DEVICE_LABEL of other nodes and reads it back', async () => {
    const uid = '1234:00000001';
    h = await setupNode({ nodeId: uid, uid }, makeDescription(uid, 0x0005, [0x0082], []));
    const w = await mountSection(uid);
    const input = w.find('[data-field="deviceLabel"] input');
    expect(value(input)).toBe('PM Node');
    await input.setValue('Truss 2');
    await input.trigger('change');
    await flushPromises();
    expect(h.argsOf('rdmSet')).toEqual([{ nodeId: uid, port: { bind: 1, index: 0 }, uid, pid: 0x0082, value: 'Truss 2' }]);
    expect(h.pidsOf('rdmGet')).toEqual([0x0082, 0x0082]); // read + read back
    expect(value(w.find('[data-field="deviceLabel"] input'))).toBe('Truss 2');
  });
});
