/**
 * Port mapping UI (plan D7, M5.5): universe per port, the node's
 * Port-Address read-only, and “Write port address to node” → ArtAddress.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import type { SharedGlobals } from '@pixelmapper/extension-api';
import { NodeDirectory } from '../bridge/node-directory';
import { installArtNetBackend } from '../bridge/shared';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeNode } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector } from '../node/node-connector';
import NodePortTable from './NodePortTable.vue';
import NodeConnectorSettings from './NodeConnectorSettings.vue';

let backend: FakeArtNetBackend;
let connector: ArtNetNodeConnector;
/** Host stub of `connectors.persist` (API 1.4). */
let persist: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Host stub: the project scope has one fixture in universe 1.
  const project = shallowRef({ fixtures: [{ id: 'f1', name: 'Tube', startAddress: 1, channelCount: 3 }] });
  persist = vi.fn();
  globalThis.__PIXELMAPPER_SHARED__ = { vue: {}, pinia: {}, api: { useScope: () => project, connectors: { persist } } as unknown as SharedGlobals['api'] };
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
  it('shows universes and node Port-Addresses and writes a differing one', async () => {
    backend.handle('artAddress', () => ({ node: makeNode() }));
    const wrapper = mount(NodePortTable, { props: { connector } });
    const text = wrapper.text();
    expect(text).toContain('Port 1');
    expect(text).toContain('node 0:0:1');
    expect(text).toContain('no fixtures'); // U2–U4 carry no fixtures (the fixture is in U1)
    const writes = wrapper.findAll('button').filter(b => b.text() === 'Write port address to node');
    expect(writes).toHaveLength(1); // only port 1: U2 ≠ Port-Address 1

    await writes[0]!.trigger('click');
    await nextTick();
    const req = backend.requests.find(r => r.type === 'artAddress');
    expect(req?.args).toEqual({ nodeId: '7FF0:8A1B2C3D', ports: [{ port: { bind: 1, index: 0 }, outputPortAddress: 2 }] });
    expect(connector.logs.at(-1)?.text).toMatch(/Port 1 → 0:0:2/);
    wrapper.unmount();
  });

  it('emits the new mapping when a universe changes', async () => {
    const wrapper = mount(NodePortTable, { props: { connector } });
    await wrapper.findAll('input')[1]!.setValue('9');
    await wrapper.findAll('input')[1]!.trigger('change');
    expect(wrapper.emitted('change')?.at(-1)).toEqual([{ outputMapping: [2, 9, 3, 4] }]);
    wrapper.unmount();
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

  it('refuses to write while the node is offline', async () => {
    backend.emit({ type: 'nodeGone', nodeId: '7FF0:8A1B2C3D', lastSeen: 0 });
    await expect(connector.writePortAddresses([{ port: { bind: 1, index: 0 }, portAddress: 0 }])).rejects.toThrow(/offline/);
    expect(backend.requests.some(r => r.type === 'artAddress')).toBe(false);
  });
});
