/**
 * Ports section against `FakeArtNetBackend` (plan M7.3): state from the
 * node directory only (a write changes nothing until the node event),
 * direction change with confirmation while data flows, “off” via RDM
 * `PORTn_ENABLED` and ArtInput, Port-Address editor, failsafe + record
 * scene, per-port PIDs, errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { BridgeCommandError } from '../bridge/backend';
import type { PortState } from '../bridge/protocol-model';
import { makePort } from '../bridge/testing/fixtures';
import NodePortsSection from './NodePortsSection.vue';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from './testing/harness';

/** Ports that can switch between output and input (Pixelmapper Node). */
const switchablePorts = (o: (bind: number) => Partial<PortState> = () => ({})) => [1, 2, 3, 4].map(b => makePort(b, b, { canInput: true, ...o(b) }));

let h: NodeHarness;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  installHost();
  h = await setupNode({ ports: switchablePorts() });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  uninstallHost();
  vi.useRealTimers();
});

/** Mounts the section and waits for the description and the PORTn_ENABLED reads. */
async function mountSection() {
  wrapper = mount(NodePortsSection, { props: { nodeId: NODE_UID, backend: h.backend, directory: h.directory } });
  await flushPromises();
  return wrapper;
}

/** Row of the port at BindIndex `bind`. */
const row = (w: VueWrapper, bind: number) => w.find(`[data-port="${bind}.0"]`);
/** Mode select of a row. */
const mode = (r: DOMWrapper<Element>) => r.find('[data-mode] select');
/** Choices of a select. */
const choices = (s: DOMWrapper<Element>) => s.findAll('option').map(o => o.attributes('value'));

describe('NodePortsSection', () => {
  it('shows every port with the node\'s state', async () => {
    const w = await mountSection();
    expect(w.findAll('[data-port]')).toHaveLength(4);
    const r = row(w, 2);
    expect(r.text()).toContain('Port 2');
    expect(mode(r).attributes('data-value')).toBe('output');
    expect(choices(mode(r))).toEqual(['output', 'input', 'off']);
    expect(r.find('select[data-merge]').attributes('data-value')).toBe('htp');
    expect(r.find('[data-rdm] [data-pm="toggle"]').attributes('aria-checked')).toBe('true');
    expect(r.find('select[data-style]').attributes('data-value')).toBe('continuous');
    expect(r.findAll('[data-port-address] [data-pm="number"]').map(i => i.attributes('data-value'))).toEqual(['0', '0', '2']);
    // PORTn_ENABLED of all four ports was read from the node.
    expect(h.pidsOf('rdmGet')).toEqual([0x8101, 0x8102, 0x8103, 0x8104]);
  });

  it('writes with ArtAddress and shows the new value only with the node event', async () => {
    const w = await mountSection();
    await row(w, 1).find('select[data-merge]').setValue('ltp');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 1, index: 0 }, merge: 'ltp' }] }]);
    expect(row(w, 1).find('select[data-merge]').attributes('data-value')).toBe('htp');
    h.update({ ports: switchablePorts(b => (b === 1 ? { output: { ...makePort(1, 1).output, merge: 'ltp' } } : {})) });
    await flushPromises();
    expect(row(w, 1).find('select[data-merge]').attributes('data-value')).toBe('ltp');
  });

  it('asks before switching a port that sends data', async () => {
    h.update({ ports: switchablePorts(b => (b === 2 ? { output: { ...makePort(2, 2).output, data: true } } : {})) });
    const w = await mountSection();
    await mode(row(w, 2)).setValue('input');
    expect(w.find('[data-confirm]').text()).toContain('Port 2 is sending (44 fps). Output stops.');
    expect(h.argsOf('artAddress')).toEqual([]);

    await w.find('[data-confirm-cancel]').trigger('click');
    expect(w.find('[data-confirm]').exists()).toBe(false);
    expect(h.argsOf('artAddress')).toEqual([]);

    await mode(row(w, 2)).setValue('input');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 2, index: 0 }, direction: 'input' }] }]);
    expect(w.find('[data-confirm]').exists()).toBe(false);
    expect(mode(row(w, 2)).attributes('data-value')).toBe('output'); // until the node reports it
  });

  it('switches idle ports without asking', async () => {
    const w = await mountSection();
    await mode(row(w, 3)).setValue('input');
    await flushPromises();
    expect(w.find('[data-confirm]').exists()).toBe(false);
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 3, index: 0 }, direction: 'input' }] }]);
  });

  it('switches output ports off with PORTn_ENABLED and shows the node\'s answer', async () => {
    const w = await mountSection();
    await mode(row(w, 3)).setValue('off');
    await flushPromises();
    expect(h.argsOf('rdmSet')).toEqual([{ nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID, pid: 0x8103, data: '00' }]);
    expect(h.pidsOf('rdmGet').filter(p => p === 0x8103)).toHaveLength(2); // initial + read back
    expect(mode(row(w, 3)).attributes('data-value')).toBe('off');

    // A change at the node's display arrives as a queued message.
    h.backend.emit({ type: 'rdmQueued', nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID, subDevice: 0, pid: 0x8103, data: '01' });
    await flushPromises();
    expect(mode(row(w, 3)).attributes('data-value')).toBe('output');
  });

  it('re-reads PORTn_ENABLED every 45 s (a queued message may go to another controller)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const w = await mountSection();
    expect(mode(row(w, 3)).attributes('data-value')).toBe('output');
    h.rdm.set(0x8103, '00'); // switched off at the node; nobody told this window
    vi.advanceTimersByTime(45_000);
    await flushPromises();
    expect(mode(row(w, 3)).attributes('data-value')).toBe('off');
  });

  it('switches input ports off with ArtInput', async () => {
    h.update({ ports: switchablePorts(b => (b === 4 ? { direction: 'input' } : {})) });
    const w = await mountSection();
    expect(row(w, 4).find('select[data-merge]').exists()).toBe(false);
    await mode(row(w, 4)).setValue('off');
    await flushPromises();
    expect(h.argsOf('artInput')).toEqual([{ nodeId: NODE_UID, bind: 4, disabled: [true] }]);
    expect(h.argsOf('rdmSet')).toEqual([]);
  });

  it('writes a staged Port-Address and shows refusals', async () => {
    h.backend.handle('artAddress', () => { throw new BridgeCommandError('invalidPortAddress', 'net/subnet'); });
    const w = await mountSection();
    const uni = row(w, 1).find('[data-part="universe"] input');
    await uni.setValue('5'); // input + change = commit of the switch
    expect(h.argsOf('artAddress')).toEqual([]); // staged only
    await row(w, 1).find('[data-write-address]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 1, index: 0 }, outputPortAddress: 5 }] }]);
    expect(row(w, 1).text()).toContain('The node refused the Port-Address');

    // The node reports the address (e.g. set at its panel): the edit is done.
    h.update({ ports: switchablePorts(b => (b === 1 ? { outputPortAddress: 5 } : {})) });
    await flushPromises();
    expect(row(w, 1).find('[data-write-address]').exists()).toBe(false);
    expect(row(w, 1).find('[data-part="universe"] [data-pm="number"]').attributes('data-value')).toBe('5');
  });

  it('sets the failsafe mode and records the scene after confirmation', async () => {
    const w = await mountSection();
    await w.find('[data-failsafe] select').setValue('zero');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, failsafe: 'zero' }]);
    expect(w.find('[data-failsafe] select').attributes('data-value')).toBe('hold');

    await w.find('[data-record-scene]').trigger('click');
    expect(w.find('[data-confirm]').text()).toContain('Record the current output of all ports as the failsafe scene?');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress').at(-1)).toEqual({ nodeId: NODE_UID, recordFailsafeScene: true });
    expect(w.text()).toContain('Scene recorded');
  });

  it('shows the per-port node PIDs of one port', async () => {
    const w = await mountSection();
    const before = h.pidsOf('rdmGet').length;
    await row(w, 2).findAll('button').find(b => b.text().includes('DMX timing'))!.trigger('click');
    await flushPromises();
    expect(h.pidsOf('rdmGet').slice(before)).toEqual([0x8111, 0x8115, 0x8119, 0x8121]);
    expect(row(w, 2).find('[data-pid="0x8111"]').text()).toContain('Port 2 DMX break');
  });

  it('shows errors in the port row', async () => {
    h.backend.handle('artAddress', () => { throw new BridgeCommandError('timeout', 'no reply'); });
    const w = await mountSection();
    await row(w, 2).find('[data-rdm] [data-pm="toggle"]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 2, index: 0 }, rdm: false }] }]);
    expect(row(w, 2).text()).toContain('The node did not answer');
    expect(row(w, 1).text()).not.toContain('The node did not answer');
  });

  it('is read-only where the node does not report switchable settings', async () => {
    h = await setupNode({ ports: [1, 2].map(b => makePort(b, b)) }); // output-only ports
    const status = { ...h.directory.getNode(NODE_UID)!.status, rdmSwitchable: false, outputStyleSwitchable: false, failsafeProgrammable: false };
    h.update({ status });
    const w = await mountSection();
    expect(choices(mode(row(w, 1)))).toEqual(['output', 'off']);
    expect(row(w, 1).find('[data-rdm] [data-pm="toggle"]').exists()).toBe(false);
    expect(row(w, 1).find('select[data-style]').exists()).toBe(false);
    expect(w.find('[data-failsafe] select').exists()).toBe(false);
    expect(w.find('[data-record-scene]').exists()).toBe(false);
  });

  it('shows the offline state', async () => {
    h.backend.emit({ type: 'nodeGone', nodeId: NODE_UID, lastSeen: 0 });
    const w = await mountSection();
    expect(w.text()).toContain('The node is offline');
    expect(w.findAll('[data-port]')).toHaveLength(0);
  });
});
