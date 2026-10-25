/**
 * Node configuration panel (plan M7.3): collapsible sections mounted only
 * while open, one `rdmDescribe` shared by all sections, the Advanced
 * section's generic form without the PIDs other sections show, and the
 * `follow` event passed on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import NodeConfigPanel from './NodeConfigPanel.vue';
import NodeAdvancedSection from './NodeAdvancedSection.vue';
import NodeNetworkSection from './NodeNetworkSection.vue';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from './testing/harness';

let h: NodeHarness;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  installHost();
  h = await setupNode();
  h.backend.handle('ipProg', () => ({ dhcp: true, ip: '2.27.44.61', mask: '255.0.0.0', gateway: '0.0.0.0' }));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  uninstallHost();
});

/** Mounts the panel and waits for the first requests. */
async function mountPanel(props: Record<string, unknown> = {}) {
  wrapper = mount(NodeConfigPanel, { props: { nodeId: NODE_UID, backend: h.backend, directory: h.directory, ...props } });
  await flushPromises();
  return wrapper;
}

/** Header button of a section. */
const header = (w: VueWrapper, title: string) => w.find(`[data-section="${title}"] > button`);

describe('NodeConfigPanel', () => {
  it('stacks the four sections with only Ports open', async () => {
    const w = await mountPanel();
    expect(w.findAll('[data-section]').map(s => s.attributes('data-section'))).toEqual(['Ports', 'Network', 'Device', 'Advanced']);
    expect(header(w, 'Ports').attributes('aria-expanded')).toBe('true');
    expect(header(w, 'Network').attributes('aria-expanded')).toBe('false');
    expect(header(w, 'Network').text()).toContain('2.27.44.61');
    expect(header(w, 'Ports').text()).toContain('4 ports');
    expect(w.findAll('[data-port]')).toHaveLength(4);
    expect(h.argsOf('ipProg')).toEqual([]); // closed sections send nothing
  });

  it('reads the node\'s RDM description once for all sections', async () => {
    const w = await mountPanel();
    await header(w, 'Device').trigger('click');
    await header(w, 'Advanced').trigger('click');
    await flushPromises();
    expect(h.argsOf('rdmDescribe')).toEqual([{ nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID }]);
    expect(w.find('[data-field="info"]').text()).toContain('1.2.0');
  });

  it('shows the remaining node parameters under Advanced', async () => {
    const w = await mountPanel({ initialOpen: ['advanced'] });
    const advanced = w.findComponent(NodeAdvancedSection);
    expect(advanced.find('[data-pid="0x8100"]').text()).toContain('Hardware revision');
    expect(advanced.find('[data-pid="0x8124"]').exists()).toBe(true); // node-wide discovery interval
    expect(advanced.find('[data-pid="0x0501"]').exists()).toBe(true); // DISPLAY_LEVEL
    for (const pid of ['0x8101', '0x8110', '0x8117', '0x811B', '0x8123']) expect(advanced.find(`[data-pid="${pid}"]`).exists()).toBe(false);
    expect(advanced.find('[data-pid="0x0082"]').exists()).toBe(false); // DEVICE_LABEL: Device section
  });

  it('explains nodes without an RDM responder', async () => {
    h = await setupNode({ nodeId: 'mac:02:00:00:00:00:01', uid: null });
    const w = await mountPanel({ nodeId: 'mac:02:00:00:00:00:01', initialOpen: ['advanced'] });
    expect(w.text()).toContain('This node reports no RDM responder');
    expect(h.argsOf('rdmDescribe')).toEqual([]);
  });

  it('passes on where the node moved', async () => {
    const w = await mountPanel({ initialOpen: ['network'] });
    w.findComponent(NodeNetworkSection).vm.$emit('follow', { nodeId: NODE_UID, ip: '10.0.0.30' });
    expect(w.emitted('follow')).toEqual([[{ nodeId: NODE_UID, ip: '10.0.0.30' }]]);
  });

  it('says when the bridge is away', async () => {
    h.backend.disconnect();
    const w = await mountPanel();
    expect(w.text()).toContain('Connect the Art-Net bridge to configure the node.');
  });
});
