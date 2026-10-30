/**
 * Node-level parts of the Art-Net card (WP13): the Failsafe group (one mode
 * for all ports, “Custom per port” derived from the node, “Mixed”, Record
 * scene only in Scene mode), the info tips (present next to the terms,
 * open on click with `data-overlay-root`, close on Escape), and Identify of
 * the node in the header with auto-off when the card closes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { FailsafeMode, PortState } from '../bridge/protocol-model';
import { makePort, makeStatus } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector } from '../node/node-connector';
import { NODE_UID, installHost, setupNode, uninstallHost, type NodeHarness } from '../node-config/testing/harness';
import NodeCard from './NodeCard.vue';

/** Four switchable ports with the failsafe modes `modes` (default all hold). */
const ports = (modes: (FailsafeMode | null)[] = ['hold', 'hold', 'hold', 'hold']): PortState[] =>
  [1, 2, 3, 4].map(b => makePort(b, b, { canInput: true, failsafe: modes[b - 1]! }));

let h: NodeHarness;
let connector: ArtNetNodeConnector | null = null;
let wrapper: VueWrapper | null = null;

beforeEach(async () => {
  installHost();
  localStorage.clear();
  h = await setupNode({ ports: ports() });
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  await connector?.disconnect();
  connector = null;
  uninstallHost();
  document.body.innerHTML = '';
});

/** Mounts the card of the harness node. */
async function mountCard() {
  connector = ArtNetNodeConnector.fromConfig('card-1', ArtNetNodeConnector.configForNode(h.directory.getNode(NODE_UID)!), { backend: h.backend, directory: h.directory });
  await connector.connect();
  wrapper = mount(NodeCard, { props: { connector, runtime: null }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

/** Opens a block by its section id. */
async function toggle(w: VueWrapper, sectionId: string) {
  await w.find(`[data-section="${sectionId}"] > div > [data-section-toggle]`).trigger('click');
  await flushPromises();
}

const group = (w: VueWrapper) => w.find('[data-failsafe-group]');
const customToggle = (w: VueWrapper) => group(w).find('[data-failsafe-custom]');

describe('Failsafe group', () => {
  it('sets one mode for all ports', async () => {
    const w = await mountCard();
    expect(group(w).find('select[data-failsafe-all]').attributes('data-value')).toBe('hold');
    expect(customToggle(w).attributes('aria-checked')).toBe('false');
    expect(w.findAll('[data-failsafe]')).toHaveLength(0); // no per-port selectors
    await group(w).find('select[data-failsafe-all]').setValue('zero');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{
      nodeId: NODE_UID,
      ports: [1, 2, 3, 4].map(bind => ({ port: { bind, index: 0 }, failsafe: 'zero' })),
    }]);
    // Shown is what the node reports.
    expect(group(w).find('select[data-failsafe-all]').attributes('data-value')).toBe('hold');
    h.update({ ports: ports(['zero', 'zero', 'zero', 'zero']) });
    await flushPromises();
    expect(group(w).find('select[data-failsafe-all]').attributes('data-value')).toBe('zero');
  });

  it('offers Record scene only in Scene mode and records all ports after confirmation', async () => {
    const w = await mountCard();
    expect(group(w).find('[data-record-scene]').exists()).toBe(false);
    h.update({ ports: ports(['scene', 'scene', 'scene', 'scene']) });
    await flushPromises();
    await group(w).find('[data-record-scene]').trigger('click');
    expect(w.find('[data-confirm]').text()).toContain('Record the current output of all 4 ports as their failsafe scenes?');
    await w.find('[data-confirm-ok]').trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress').at(-1)).toEqual({
      nodeId: NODE_UID,
      ports: [1, 2, 3, 4].map(bind => ({ port: { bind, index: 0 }, recordFailsafeScene: true })),
    });
    expect(group(w).text()).toContain('Scene recorded');
  });

  it('switches to custom when the node\'s ports differ and shows the selector in each port', async () => {
    h.update({ ports: ports(['zero', 'zero', 'hold', 'zero']) });
    const w = await mountCard();
    expect(customToggle(w).attributes('aria-checked')).toBe('true');
    expect(group(w).find('[data-failsafe-custom-note]').exists()).toBe(true);
    await toggle(w, 'port:3.0');
    const port3 = w.find('[data-port="3.0"] [data-failsafe]');
    expect(port3.find('select').attributes('data-value')).toBe('hold');
    expect(port3.find('[data-record-scene]').exists()).toBe(false); // not Scene
    await port3.find('select').setValue('scene');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 3, index: 0 }, failsafe: 'scene' }] }]);
    h.update({ ports: ports(['zero', 'zero', 'scene', 'zero']) });
    await flushPromises();
    await w.find('[data-port="3.0"] [data-record-scene]').trigger('click');
    expect(w.find('[data-confirm]').text()).toContain('Record the current output of Port 3 as the failsafe scene?');
  });

  it('shows Mixed when custom is turned off while ports differ, and writes nothing until a mode is chosen', async () => {
    h.update({ ports: ports(['zero', 'hold', 'hold', 'hold']) });
    const w = await mountCard();
    await customToggle(w).trigger('click');
    await flushPromises();
    expect(customToggle(w).attributes('aria-checked')).toBe('false');
    expect(group(w).find('[data-failsafe-mixed]').exists()).toBe(true);
    expect(group(w).text()).toContain('Choosing a mode sets all ports.');
    expect(h.argsOf('artAddress')).toEqual([]);
    await group(w).find('select[data-failsafe-all]').setValue('full');
    await flushPromises();
    expect(h.argsOf('artAddress')).toHaveLength(1);
  });

  it('turns custom on by choice while all ports are equal', async () => {
    const w = await mountCard();
    await customToggle(w).trigger('click');
    await toggle(w, 'port:1.0');
    expect(w.find('[data-port="1.0"] [data-failsafe] select').attributes('data-value')).toBe('hold');
  });

  it('shows a mode the bridge does not report as unknown in custom mode, still writable', async () => {
    h.update({ ports: ports(['hold', 'zero', null, null]) });
    const w = await mountCard();
    await toggle(w, 'port:3.0');
    expect(w.find('[data-port="3.0"] [data-failsafe-unknown]').text()).toBe('unknown');
    await w.find('[data-port="3.0"] [data-failsafe] select').setValue('full');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, ports: [{ port: { bind: 3, index: 0 }, failsafe: 'full' }] }]);
  });

  it('is read-only on nodes without a programmable failsafe', async () => {
    h.update({ status: makeStatus({ failsafeProgrammable: false }) });
    const w = await mountCard();
    expect(group(w).find('select').exists()).toBe(false);
    expect(group(w).text()).toContain('Hold');
    expect(customToggle(w).exists()).toBe(false);
    expect(w.find('[data-record-scene]').exists()).toBe(false);
  });
});

describe('Info tips', () => {
  it('sit next to the technical terms', async () => {
    h.backend.handle('ipProg', () => ({ dhcp: true, ip: '2.27.44.61', mask: '255.0.0.0', gateway: '0.0.0.0' }));
    const w = await mountCard();
    await toggle(w, 'port:2.0');
    await toggle(w, 'port:2.0:advanced');
    await toggle(w, 'network');
    const topics = new Set(w.findAll('[data-info-tip]').map(t => t.attributes('data-info-tip')));
    for (const topic of ['identifyNode', 'failsafe', 'failsafeCustom', 'direction', 'universeMapping', 'portAddress', 'rdm', 'portAdvanced', 'merge', 'outputStyle', 'dmxTiming', 'backgroundDiscovery', 'nodeAdvanced', 'networkMode', 'networkApply']) {
      expect(topics, topic).toContain(topic);
    }
  });

  it('open on click as an overlay the sidebar ignores and close on Escape', async () => {
    const w = await mountCard();
    await toggle(w, 'port:1.0');
    const tip = w.find('[data-port="1.0"] [data-info-tip="portAddress"]');
    expect(tip.attributes('aria-label')).toBe('About Port-Address');
    await tip.trigger('click');
    const bubble = document.body.querySelector('[data-info-bubble="portAddress"]');
    expect(bubble?.hasAttribute('data-overlay-root')).toBe(true);
    expect(bubble?.getAttribute('role')).toBe('tooltip');
    expect(bubble?.textContent).toContain('Net:Sub-Net:Universe');
    expect(tip.attributes('aria-describedby')).toBe(bubble?.id);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.body.querySelector('[data-info-bubble]')).toBeNull();
  });

  it('open on keyboard focus', async () => {
    const w = await mountCard();
    await w.find('[data-info-tip="failsafe"]').trigger('focus');
    expect(document.body.querySelector('[data-info-bubble="failsafe"]')?.textContent).toContain('not of the fixtures');
    await w.find('[data-info-tip="failsafe"]').trigger('blur');
    expect(document.body.querySelector('[data-info-bubble]')).toBeNull();
  });
});

describe('Header', () => {
  it('identifies the node with the flashlight and switches it off when the card closes', async () => {
    const w = await mountCard();
    const button = w.find('[data-node-identify] [data-identify-button]');
    await button.trigger('click');
    await flushPromises();
    expect(h.argsOf('artAddress')).toEqual([{ nodeId: NODE_UID, indicator: 'locate' }]);
    h.update({ status: makeStatus({ indicator: 'locate' }) });
    await flushPromises();
    expect(w.find('[data-node-identify] [data-identify-button]').attributes('aria-pressed')).toBe('true');
    expect(w.find('[data-card-header]').text()).toContain('Locating');
    wrapper!.unmount();
    wrapper = null;
    expect(h.argsOf('artAddress').at(-1)).toEqual({ nodeId: NODE_UID, indicator: 'normal' });
  });

  it('leaves identify alone when it was started elsewhere', async () => {
    h.update({ status: makeStatus({ indicator: 'locate' }) });
    await mountCard();
    wrapper!.unmount();
    wrapper = null;
    expect(h.argsOf('artAddress')).toEqual([]);
  });
});
