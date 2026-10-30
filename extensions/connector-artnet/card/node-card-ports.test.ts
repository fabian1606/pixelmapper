/**
 * The Art-Net card's ports against `FakeArtNetBackend` (WP13; logic of plan
 * M7.3): one collapsible block per port with a summary line, state from
 * the node directory only (a write changes nothing until the node event),
 * direction change with confirmation while data flows, “off” via RDM
 * `PORTn_ENABLED` and ArtInput, Port-Address editor, the universe mapping,
 * per-port PIDs under the port's Advanced, re-reads on node changes,
 * errors, and the remembered open/closed state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { BridgeCommandError } from '../bridge/backend';
import type { PortState } from '../bridge/protocol-model';
import { makePort } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector } from '../node/node-connector';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from '../node-config/testing/harness';
import NodeCard from './NodeCard.vue';
import { CARD_COLLAPSE_KEY_PREFIX } from './use-card-collapse';

/** Ports that can switch between output and input (Pixelmapper Node). */
const switchablePorts = (o: (bind: number) => Partial<PortState> = () => ({})) => [1, 2, 3, 4].map(b => makePort(b, b, { canInput: true, ...o(b) }));

let h: NodeHarness;
let connector: ArtNetNodeConnector | null = null;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  installHost();
  localStorage.clear();
  h = await setupNode({ ports: switchablePorts() });
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  await connector?.disconnect();
  connector = null;
  uninstallHost();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Mounts the card of the harness node and waits for the description and the PORTn_ENABLED reads. */
async function mountCard(id = 'card-1') {
  const node = h.directory.getNode(NODE_UID);
  connector = ArtNetNodeConnector.fromConfig(id, node ? ArtNetNodeConnector.configForNode(node) : { nodeId: NODE_UID, ports: ['1.0', '2.0', '3.0', '4.0'], outputCount: 4, outputMapping: [1, 2, 3, 4] }, { backend: h.backend, directory: h.directory });
  await connector.connect();
  wrapper = mount(NodeCard, { props: { connector, runtime: null }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

/** Block of the port at BindIndex `bind`. */
const row = (w: VueWrapper, bind: number) => w.find(`[data-port="${bind}.0"]`);
/** Opens/closes a collapsible block by its section id. */
async function toggle(w: VueWrapper, sectionId: string) {
  await w.find(`[data-section="${sectionId}"] > div > [data-section-toggle]`).trigger('click');
  await flushPromises();
}
/** Opens the block of port `bind`. */
const openPort = (w: VueWrapper, bind: number) => toggle(w, `port:${bind}.0`);
/** Mode select of a block. */
const mode = (r: DOMWrapper<Element>) => r.find('[data-mode] select');
/** Choices of a select. */
const choices = (s: DOMWrapper<Element>) => s.findAll('option').map(o => o.attributes('value'));

describe('NodeCard ports', () => {
  it('shows one collapsed block per port with a summary line', async () => {
    const w = await mountCard();
    expect(w.findAll('[data-port]')).toHaveLength(4);
    // More than two ports: closed by default; the header line still tells the essentials.
    expect(row(w, 2).find('[data-port-essentials]').exists()).toBe(false);
    const summary = row(w, 2).find('[data-port-summary]').text();
    expect(summary).toContain('Output');
    expect(summary).toContain('U2 → 0:0:2');
    // PORTn_ENABLED of all four ports was read from the node, once for the card.
    expect(h.pidsOf('rdmGet')).toEqual([0x8101, 0x8102, 0x8103, 0x8104]);

    await openPort(w, 2);
    const r = row(w, 2);
    expect(mode(r).attributes('data-value')).toBe('output');
    expect(choices(mode(r))).toEqual(['output', 'input', 'off']);
    expect(r.find('[data-rdm] [data-pm="toggle"]').attributes('aria-checked')).toBe('true');
    expect(r.findAll('[data-port-address] [data-pm="number"]').map(i => i.attributes('data-value'))).toEqual(['0', '0', '2']);
    expect((r.find('input[data-universe]').element as HTMLInputElement).value).toBe('2');
  });

  it('opens ports by default when the node has at most two', async () => {
    h = await setupNode({ ports: [1, 2].map(b => makePort(b, b, { canInput: true })) });
    const w = await mountCard();
    expect(row(w, 1).find('[data-port-essentials]').exists()).toBe(true);
    expect(row(w, 2).find('[data-port-essentials]').exists()).toBe(true);
    // Advanced inside a port and the node sections stay closed.
    expect(row(w, 1).find('[data-port-advanced]').exists()).toBe(false);
    expect(w.find('[data-section="network"] > div > [data-section-toggle]').attributes('aria-expanded')).toBe('false');
  });

  it('remembers open blocks per connector', async () => {
    let w = await mountCard();
    await openPort(w, 2);
    await toggle(w, 'port:2.0:advanced');
    expect(JSON.parse(localStorage.getItem(`${CARD_COLLAPSE_KEY_PREFIX}card-1`)!)).toEqual({ 'port:2.0': true, 'port:2.0:advanced': true });
    wrapper!.unmount();
    await connector!.disconnect();
    w = await mountCard();
    expect(row(w, 2).find('[data-port-advanced]').exists()).toBe(true);
    expect(row(w, 1).find('[data-port-essentials]').exists()).toBe(false);
    // Another connector has its own layout.
    wrapper!.unmount();
    await connector!.disconnect();
    w = await mountCard('card-2');
    expect(row(w, 2).find('[data-port-essentials]').exists()).toBe(false);
  });

  it('survives unusable stored layout', async () => {
    localStorage.setItem(`${CARD_COLLAPSE_KEY_PREFIX}card-1`, '{not json');
    const w = await mountCard();
    expect(w.findAll('[data-port]')).toHaveLength(4);
  });

  it('emits the new universe mapping and points out a differing Port-Address', async () => {
    const w = await mountCard();
    await openPort(w, 2);
    await row(w, 2).find('input[data-universe]').setValue('9');
    expect(w.emitted('change')?.at(-1)).toEqual([{ outputMapping: [1, 9, 3, 4] }]);
    // The host applies the patch: the port now differs from its Port-Address (DMX still arrives).
    connector!.applyConfig({ outputMapping: [1, 9, 3, 4] });
    await flushPromises();
    expect(row(w, 2).find('[data-differs]').text()).toContain('0:0:2');
    expect(row(w, 2).find('[data-port-summary]').text()).toContain('U9 → 0:0:2');
  });

  it('writes with ArtAddress and shows the new value only with the node event', async () => {
    const w = await mountCard();
    await openPort(w, 1);
    await toggle(w, 'port:1.0:advanced');
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
    const w = await mountCard();
    await openPort(w, 2);
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
    const w = await mountCard();
    await openPort(w, 3);
    await mode(row(w, 3)).setValue('input');
    await flushPromises();
    expect(w.find('[data-confirm]').exists()).toBe(false);
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 3, index: 0 }, direction: 'input' }] }]);
  });

  it('switches output ports off with PORTn_ENABLED and shows the node\'s answer', async () => {
    const w = await mountCard();
    await openPort(w, 3);
    await mode(row(w, 3)).setValue('off');
    await flushPromises();
    expect(h.argsOf('rdmSet')).toEqual([{ nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID, pid: 0x8103, data: '00' }]);
    expect(h.pidsOf('rdmGet').filter(p => p === 0x8103)).toHaveLength(2); // initial + read back
    expect(mode(row(w, 3)).attributes('data-value')).toBe('off');
    expect(row(w, 3).find('[data-port-summary]').text()).toContain('Off');

    // A change at the node's display arrives as a queued message.
    h.backend.emit({ type: 'rdmQueued', nodeId: NODE_UID, port: { bind: 1, index: 0 }, uid: NODE_UID, subDevice: 0, pid: 0x8103, data: '01' });
    await flushPromises();
    expect(mode(row(w, 3)).attributes('data-value')).toBe('output');
  });

  it('re-reads PORTn_ENABLED every 45 s (a queued message may go to another controller)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const w = await mountCard();
    await openPort(w, 3);
    expect(mode(row(w, 3)).attributes('data-value')).toBe('output');
    h.rdm.set(0x8103, '00'); // switched off at the node; nobody told this window
    vi.advanceTimersByTime(45_000);
    await flushPromises();
    expect(mode(row(w, 3)).attributes('data-value')).toBe('off');
  });

  it('switches input ports off with ArtInput', async () => {
    h.update({ ports: switchablePorts(b => (b === 4 ? { direction: 'input' } : {})) });
    const w = await mountCard();
    await openPort(w, 4);
    expect(row(w, 4).find('[data-section="port:4.0:advanced"]').exists()).toBe(false);
    expect(row(w, 4).find('input[data-universe]').exists()).toBe(false); // not an output
    await mode(row(w, 4)).setValue('off');
    await flushPromises();
    expect(h.argsOf('artInput')).toEqual([{ nodeId: NODE_UID, bind: 4, disabled: [true] }]);
    expect(h.argsOf('rdmSet')).toEqual([]);
  });

  it('writes a staged Port-Address and shows refusals', async () => {
    h.backend.handle('artAddress', () => { throw new BridgeCommandError('invalidPortAddress', 'net/subnet'); });
    const w = await mountCard();
    await openPort(w, 1);
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

  it('re-reads the node\'s RDM-only port settings when the node changes, not on its poll counter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountCard();
    await openPort(w, 3);
    const reads = () => h.pidsOf('rdmGet').filter(p => p === 0x8103).length;
    expect(reads()).toBe(1);
    h.update({ nodeReport: '#0001 [0002] OK', lastSeen: 1 }); // counter only
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(reads()).toBe(1);

    h.rdm.set(0x8103, '00'); // switched off at the node's display; the queued message went elsewhere
    h.update({ shortName: 'Changed at the panel' });
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(reads()).toBe(2);
    expect(mode(row(w, 3)).attributes('data-value')).toBe('off');
  });

  it('shows the per-port node PIDs under the port\'s Advanced', async () => {
    const w = await mountCard();
    await openPort(w, 2);
    const before = h.pidsOf('rdmGet').length;
    await toggle(w, 'port:2.0:advanced');
    expect(h.pidsOf('rdmGet').slice(before)).toEqual([0x8111, 0x8115, 0x8119, 0x8121]);
    expect(row(w, 2).find('[data-pid="0x8111"]').text()).toContain('Port 2 DMX break');
  });

  it('shows errors in the port block', async () => {
    h.backend.handle('artAddress', () => { throw new BridgeCommandError('timeout', 'no reply'); });
    const w = await mountCard();
    await openPort(w, 1);
    await openPort(w, 2);
    await row(w, 2).find('[data-rdm] [data-pm="toggle"]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 2, index: 0 }, rdm: false }] }]);
    expect(row(w, 2).text()).toContain('The node did not answer');
    expect(row(w, 1).text()).not.toContain('The node did not answer');
  });

  it('is read-only where the node does not report switchable settings', async () => {
    h = await setupNode({ ports: [1, 2].map(b => makePort(b, b)) }); // output-only ports
    const status = { ...h.directory.getNode(NODE_UID)!.status, rdmSwitchable: false, outputStyleSwitchable: false };
    h.update({ status });
    const w = await mountCard();
    await toggle(w, 'port:1.0:advanced');
    expect(choices(mode(row(w, 1)))).toEqual(['output', 'off']);
    expect(row(w, 1).find('[data-rdm] [data-pm="toggle"]').exists()).toBe(false);
    expect(row(w, 1).find('select[data-style]').exists()).toBe(false);
  });

  it('keeps the ports and the universe mapping while the node is offline', async () => {
    const w = await mountCard();
    h.backend.emit({ type: 'nodeGone', nodeId: NODE_UID, lastSeen: 0 });
    await flushPromises();
    expect(w.find('[data-offline]').exists()).toBe(true);
    expect(w.findAll('[data-port]')).toHaveLength(4);
    await openPort(w, 1);
    expect(row(w, 1).text()).toContain('The node is offline');
    expect(row(w, 1).find('input[data-universe]').exists()).toBe(true);
    expect(row(w, 1).find('[data-mode]').exists()).toBe(false);
  });
});
