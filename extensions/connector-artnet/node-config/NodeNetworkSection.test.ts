/**
 * Network section against `FakeArtNetBackend` (plan M7.3): values read
 * from the node (ArtIpProg without changes), staged edits with validation,
 * Apply / Reset only after confirmation, the diff as `ipProg`, following
 * the node to its new IP by its UID, errors.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { BridgeCommandError } from '../bridge/backend';
import type { IpProgArgs } from '../bridge/protocol-messages';
import { makeStatus } from '../bridge/testing/fixtures';
import type { NetworkSettings } from './network-draft';
import NodeNetworkSection from './NodeNetworkSection.vue';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from './testing/harness';

let h: NodeHarness;
let wrapper: VueWrapper | null = null;
/** Network settings of the fake node. */
let net: NetworkSettings;

beforeEach(async () => {
  installHost();
  h = await setupNode({ ip: '10.0.0.20', status: makeStatus({ dhcpConfigured: false }) });
  net = { dhcp: false, ip: '10.0.0.20', mask: '255.255.255.0', gateway: '10.0.0.1' };
  // The node applies what it is sent and replies with its settings (ArtIpProgReply).
  h.backend.handle('ipProg', (args: IpProgArgs) => {
    if (args.resetToDefault) net = { dhcp: true, ip: net.ip, mask: net.mask, gateway: '0.0.0.0' };
    else if (args.dhcp === true) net = { ...net, dhcp: true };
    else net = { dhcp: args.dhcp ?? net.dhcp, ip: args.ip ?? net.ip, mask: args.mask ?? net.mask, gateway: args.gateway ?? net.gateway };
    return { ...net };
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  uninstallHost();
});

/** Mounts the section and waits for the first read. */
async function mountSection(props: Record<string, unknown> = {}) {
  wrapper = mount(NodeNetworkSection, { props: { nodeId: NODE_UID, backend: h.backend, directory: h.directory, ...props } });
  await flushPromises();
  return wrapper;
}

/** `ipProg` requests that change something (not the plain reads). */
const writes = () => h.argsOf('ipProg').filter(a => Object.keys(a as object).length > 1);
const ipInput = (w: VueWrapper) => w.find('input[aria-label="IP address"]');
const applyButton = (w: VueWrapper) => w.find('[data-apply]');

/** Types a new IP and opens the confirmation. */
async function stageIp(w: VueWrapper, ip: string) {
  await ipInput(w).setValue(ip);
  await applyButton(w).trigger('click');
}

describe('NodeNetworkSection', () => {
  it('reads the node\'s settings with an ArtIpProg without changes', async () => {
    const w = await mountSection();
    expect(h.argsOf('ipProg')).toEqual([{ nodeId: NODE_UID }]);
    expect((ipInput(w).element as HTMLInputElement).value).toBe('10.0.0.20');
    expect(w.find('[data-field="mode"] select').attributes('data-value')).toBe('static');
    expect(w.find('[data-field="mask"] select').attributes('data-value')).toBe('24');
    expect(w.find('[data-field="mask"] option[value="24"]').text()).toBe('255.255.255.0 (/24)');
    expect((w.find('input[aria-label="Gateway"]').element as HTMLInputElement).value).toBe('10.0.0.1');
    expect(applyButton(w).attributes('disabled')).toBeDefined(); // nothing staged

    // Other node changes (report, data flags) do not read again; an IP change does.
    h.update({ nodeReport: '#0001 [0002] OK' });
    await flushPromises();
    expect(h.argsOf('ipProg')).toHaveLength(1);
    h.update({ ip: '10.0.0.21' });
    await flushPromises();
    expect(h.argsOf('ipProg')).toHaveLength(2);
  });

  it('stages and validates edits without sending', async () => {
    const w = await mountSection();
    await ipInput(w).setValue('10.0.0.255');
    expect(w.text()).toContain('10.0.0.255 is the broadcast address of this subnet');
    expect(applyButton(w).attributes('disabled')).toBeDefined();
    await w.find('[data-field="mask"] select').setValue('16');
    expect(w.text()).not.toContain('broadcast address'); // a host in a /16
    expect(applyButton(w).attributes('disabled')).toBeUndefined();
    expect(writes()).toEqual([]);
  });

  it('applies after confirmation and follows the node to its new IP', async () => {
    const w = await mountSection();
    await stageIp(w, '10.0.0.30');
    const confirm = w.find('[data-confirm]');
    expect(confirm.text()).toContain('The node will use IP 10.0.0.30 / 255.255.255.0, gateway 10.0.0.1.');
    expect(confirm.text()).toContain('Running Art-Net connections to this node drop');
    await w.find('[data-confirm-cancel]').trigger('click');
    expect(writes()).toEqual([]);

    await applyButton(w).trigger('click');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(writes()).toEqual([{ nodeId: NODE_UID, ip: '10.0.0.30' }]);
    expect(w.find('[data-follow]').text()).toBe('Waiting for the node at 10.0.0.30…');
    expect(h.backend.pollTargets.has('10.0.0.30')).toBe(true); // found even outside the broadcast domain

    // The node answers from its new IP with the same UID.
    h.update({ ip: '10.0.0.30' });
    await flushPromises();
    expect(w.find('[data-follow]').text()).toBe('The node answers at 10.0.0.30.');
    expect(w.emitted('follow')).toEqual([[{ nodeId: NODE_UID, ip: '10.0.0.30' }]]);
    expect(h.backend.pollTargets.has('10.0.0.30')).toBe(false);
    expect(h.argsOf('ipProg').at(-1)).toEqual({ nodeId: NODE_UID }); // re-read at the new address
    expect((ipInput(w).element as HTMLInputElement).value).toBe('10.0.0.30');
  });

  it('switches to DHCP and waits for the node\'s DHCP address', async () => {
    const w = await mountSection();
    await w.find('[data-field="mode"] select').setValue('dhcp');
    expect(ipInput(w).attributes('disabled')).toBeDefined();
    await applyButton(w).trigger('click');
    expect(w.find('[data-confirm]').text()).toContain('DHCP');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(writes()).toEqual([{ nodeId: NODE_UID, dhcp: true }]);
    expect(w.find('[data-follow]').text()).toBe('Waiting for the node to get its address…');
    expect(h.backend.pollTargets.size).toBe(0);
    h.update({ ip: '192.168.1.44', status: makeStatus({ dhcpConfigured: true }) });
    await flushPromises();
    expect(w.find('[data-follow]').text()).toBe('The node answers at 192.168.1.44.');
  });

  it('resets the network after confirmation', async () => {
    const w = await mountSection();
    await w.find('[data-reset]').trigger('click');
    expect(w.find('[data-confirm]').text()).toContain('Reset the node\'s network settings to the factory defaults?');
    expect(writes()).toEqual([]);
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(writes()).toEqual([{ nodeId: NODE_UID, resetToDefault: true }]);
    expect(w.find('[data-field="mode"] select').attributes('data-value')).toBe('dhcp'); // from the reply
  });

  it('shows a failed apply and keeps the staged values', async () => {
    const w = await mountSection();
    h.backend.handle('ipProg', () => { throw new BridgeCommandError('timeout', 'no reply'); });
    await stageIp(w, '10.0.0.30');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('The node did not answer');
    expect((ipInput(w).element as HTMLInputElement).value).toBe('10.0.0.30');
    expect(w.find('[data-follow]').exists()).toBe(false);
  });

  it('reports a node that does not answer at its new IP', async () => {
    const w = await mountSection({ followTimeoutMs: 10 });
    await stageIp(w, '10.0.0.30');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    await new Promise(r => setTimeout(r, 30));
    expect(w.find('[data-follow]').text()).toContain('The node has not answered at 10.0.0.30 yet');
    h.update({ ip: '10.0.0.30' }); // late answer
    await flushPromises();
    expect(w.find('[data-follow]').text()).toBe('The node answers at 10.0.0.30.');
  });

  it('shows a failed read', async () => {
    h.backend.handle('ipProg', () => { throw new BridgeCommandError('timeout', 'no reply'); });
    const w = await mountSection();
    expect(w.text()).toContain('Reading the network settings failed: The node did not answer');
  });
});
