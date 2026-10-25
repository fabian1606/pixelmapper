/**
 * Port mapping UI (plan D7, M5.5): universe per port and the node's
 * Port-Address read-only (it is written only in the node configuration's
 * Ports section, M7.3); the card mounts the configuration and “Update
 * tubes…” once the node is known.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, shallowRef } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { SharedGlobals } from '@pixelmapper/extension-api';
import { NodeDirectory } from '../bridge/node-directory';
import { installArtNetBackend } from '../bridge/shared';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeNode } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector } from '../node/node-connector';
import NodeConfigPanel from '../node-config/NodeConfigPanel.vue';
import NodePortTable from './NodePortTable.vue';
import NodeConnectorSettings from './NodeConnectorSettings.vue';

/** `pm.*` inputs of the node configuration, rendered as plain elements. */
const PmStub = defineComponent({ props: ['modelValue', 'options', 'disabled', 'size', 'variant'], setup: () => () => h('span', { 'data-pm': '' }) });

let backend: FakeArtNetBackend;
let connector: ArtNetNodeConnector;
/** Host stub of `connectors.persist` (API 1.4). */
let persist: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Host stub: the project scope has one fixture in universe 1.
  const project = shallowRef({ fixtures: [{ id: 'f1', name: 'Tube', startAddress: 1, channelCount: 3 }] });
  persist = vi.fn();
  globalThis.__PIXELMAPPER_SHARED__ = {
    vue: {}, pinia: {},
    api: { useScope: () => project, connectors: { persist }, useReplaceable: () => computed(() => PmStub) } as unknown as SharedGlobals['api'],
  };
  backend = new FakeArtNetBackend();
  const directory = new NodeDirectory(backend);
  backend.start();
  backend.emit({ type: 'node', node: makeNode() });
  connector = ArtNetNodeConnector.fromConfig('n1', { ...ArtNetNodeConnector.configForNode(makeNode()), outputMapping: [2, 2, 3, 4] }, { backend, directory });
  await connector.connect();
});

afterEach(async () => {
  await connector.disconnect();
  globalThis.__PIXELMAPPER_SHARED__ = undefined;
});

describe('NodePortTable', () => {
  it('shows universes and the node Port-Addresses read-only, and points out a difference', async () => {
    const wrapper = mount(NodePortTable, { props: { connector } });
    const text = wrapper.text();
    expect(text).toContain('Port 1');
    expect(text).toContain('node 0:0:1');
    expect(text).toContain('no fixtures'); // U2–U4 carry no fixtures (the fixture is in U1)
    // Only port 1 differs (U2 ≠ Port-Address 1); the Port-Address is written in the node configuration only.
    expect(wrapper.findAll('[data-differs]').map(d => d.text())).toEqual(['≠ U2']);
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(backend.requests.some(r => r.type === 'artAddress')).toBe(false);
    wrapper.unmount();
  });

  it('emits the new mapping when a universe changes', async () => {
    const wrapper = mount(NodePortTable, { props: { connector } });
    await wrapper.findAll('input')[1]!.setValue('9');
    await wrapper.findAll('input')[1]!.trigger('change');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ outputMapping: [2, 9, 3, 4] }]);
    wrapper.unmount();
  });

  it('mounts the node configuration and “Update tubes…” once the node is known', async () => {
    installArtNetBackend(backend);
    const wrapper = mount(NodeConnectorSettings, { props: { connector }, attachTo: document.body });
    await flushPromises();
    // Node configuration below the device list; its Ports section is the only Port-Address editor.
    expect(wrapper.find('[data-node-config]').exists()).toBe(true);
    expect(wrapper.findAll('[data-port]')).toHaveLength(4);
    expect(wrapper.text()).not.toContain('Write port address to node');

    await wrapper.find('[data-update-tubes]').trigger('click');
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Update tube firmware');

    // A network change moved the node: the card follows it.
    wrapper.findComponent(NodeConfigPanel).vm.$emit('follow', { nodeId: '7FF0:8A1B2C3D', ip: '10.0.0.5' });
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ nodeId: '7FF0:8A1B2C3D', ip: '10.0.0.5' }]);
    wrapper.unmount();
    document.body.innerHTML = '';
    installArtNetBackend(null);
  });

  it('persists what the connector learns from the network, card open or not', async () => {
    installArtNetBackend(backend);
    const wrapper = mount(NodeConnectorSettings, { props: { connector } });
    await nextTick();
    expect(wrapper.text()).toContain('Port 1');
    wrapper.unmount();
    persist.mockClear();
    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.9' }) });
    await nextTick();
    expect(connector.getConfig().ip).toBe('10.0.0.9');
    expect(persist).toHaveBeenCalledWith('n1');
    installArtNetBackend(null);
  });
});
