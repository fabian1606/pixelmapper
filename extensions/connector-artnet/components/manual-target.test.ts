/**
 * Card of the one `artnet` connector type for a manual target (a device added
 * by IP that never answered ArtPoll): universe → Port-Address outputs that
 * can be edited, added and removed; and the device sections that appear
 * only when the device supports them (RDM devices and tube firmware).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, shallowRef } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { SharedGlobals } from '@pixelmapper/extension-api';
import { NodeDirectory } from '../bridge/node-directory';
import { installArtNetBackend } from '../bridge/shared';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeNode, makeStatus } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector } from '../node/node-connector';
import ManualTargetPorts from './ManualTargetPorts.vue';
import NodeNetworkSection from '../node-config/NodeNetworkSection.vue';
import NodeConnectorSettings from './NodeConnectorSettings.vue';

/** `pm.*` inputs of the node configuration, rendered as plain elements. */
const PmStub = defineComponent({ props: ['modelValue', 'options', 'disabled', 'size', 'variant'], setup: () => () => h('span', { 'data-pm': '' }) });

let backend: FakeArtNetBackend;
let directory: NodeDirectory;
const created: ArtNetNodeConnector[] = [];

beforeEach(() => {
  const project = shallowRef({ fixtures: [] });
  globalThis.__PIXELMAPPER_SHARED__ = {
    vue: {}, pinia: {},
    api: { useScope: () => project, connectors: { persist: vi.fn() }, useReplaceable: () => computed(() => PmStub) } as unknown as SharedGlobals['api'],
  };
  backend = new FakeArtNetBackend();
  directory = new NodeDirectory(backend);
  backend.start();
  installArtNetBackend(backend);
});

afterEach(async () => {
  for (const c of created.splice(0)) await c.disconnect();
  installArtNetBackend(null);
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
  document.body.innerHTML = '';
});

/** A connected connector from `config`. */
async function connector(config: Record<string, unknown>) {
  const c = ArtNetNodeConnector.fromConfig(crypto.randomUUID(), config, { backend, directory });
  created.push(c);
  await c.connect();
  return c;
}

describe('manual target card', () => {
  it('shows the universe → Port-Address outputs instead of the node sections', async () => {
    const c = await connector(ArtNetNodeConnector.configForIp('10.0.0.60'));
    const wrapper = mount(NodeConnectorSettings, { props: { connector: c } });
    await flushPromises();
    expect(wrapper.find('[data-manual-target]').exists()).toBe(true);
    expect(wrapper.text()).toContain('no ArtPollReply');
    expect(wrapper.find('[data-update-tubes]').exists()).toBe(false);
    expect(wrapper.find('[data-node-card]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('edits, adds and removes outputs as one patch each', async () => {
    const c = await connector({ ...ArtNetNodeConnector.configForIp('10.0.0.60'), ...ArtNetNodeConnector.manualOutputsPatch([{ universe: 1, portAddress: 0 }, { universe: 2, portAddress: 1 }]) });
    const wrapper = mount(ManualTargetPorts, { props: { connector: c } });
    expect(wrapper.findAll('[data-manual-output]')).toHaveLength(2);

    await wrapper.findAll('[data-port-address]')[1]!.setValue('17');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ portAddresses: [0, 17], outputCount: 2, outputMapping: [1, 2] }]);

    await wrapper.findAll('[data-universe]')[0]!.setValue('5');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ portAddresses: [0, 1], outputCount: 2, outputMapping: [5, 2] }]);

    await wrapper.find('[data-add-output]').trigger('click');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ portAddresses: [0, 1, 3], outputCount: 3, outputMapping: [1, 2, 3] }]);

    await wrapper.findAll('[data-remove-output]')[0]!.trigger('click');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ portAddresses: [1], outputCount: 1, outputMapping: [2] }]);

    // The host applies the patch like any connector config.
    c.applyConfig(ArtNetNodeConnector.manualOutputsPatch([{ universe: 4, portAddress: 9 }]));
    await nextTick();
    expect(wrapper.findAll('[data-manual-output]')).toHaveLength(1);
    wrapper.unmount();
  });

  it('switches to the node sections once the device answers ArtPoll', async () => {
    const c = await connector(ArtNetNodeConnector.configForIp('2.27.44.61'));
    const wrapper = mount(NodeConnectorSettings, { props: { connector: c } });
    backend.emit({ type: 'node', node: makeNode() });
    await flushPromises();
    expect(wrapper.find('[data-manual-target]').exists()).toBe(false);
    expect(wrapper.find('[data-node-card]').exists()).toBe(true);
    expect(wrapper.find('[data-update-tubes]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('device sections', () => {
  it('hides RDM devices and tube firmware for a node without RDM', async () => {
    const node = makeNode({ status: makeStatus({ rdmCapable: false }) });
    backend.emit({ type: 'node', node });
    const c = await connector(ArtNetNodeConnector.configForNode(node));
    const wrapper = mount(NodeConnectorSettings, { props: { connector: c } });
    await flushPromises();
    expect(wrapper.find('[data-update-tubes]').exists()).toBe(false);
    expect(wrapper.find('[data-node-card]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Port 1');
    wrapper.unmount();
  });

  it('opens “Update tubes…”, follows the node after a network change and persists what it learns', async () => {
    const node = makeNode();
    backend.emit({ type: 'node', node });
    backend.handle('ipProg', () => ({ dhcp: true, ip: node.ip, mask: '255.0.0.0', gateway: '0.0.0.0' }));
    const c = await connector(ArtNetNodeConnector.configForNode(node));
    const wrapper = mount(NodeConnectorSettings, { props: { connector: c }, attachTo: document.body });
    await flushPromises();
    await wrapper.find('[data-update-tubes]').trigger('click');
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Update tube firmware');

    // A network change moved the node: the card follows it.
    await wrapper.find('[data-section="network"] > div > [data-section-toggle]').trigger('click');
    wrapper.findComponent(NodeNetworkSection).vm.$emit('follow', { nodeId: node.nodeId, ip: '10.0.0.5' });
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ nodeId: node.nodeId, ip: '10.0.0.5' }]);
    wrapper.unmount();

    // What the connector learns from the network is persisted, card open or not.
    const persist = (globalThis.__PIXELMAPPER_SHARED__!.api as unknown as { connectors: { persist: ReturnType<typeof vi.fn> } }).connectors.persist;
    persist.mockClear();
    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.9' }) });
    await nextTick();
    expect(c.getConfig().ip).toBe('10.0.0.9');
    expect(persist).toHaveBeenCalledWith(c.id);
  });
});
