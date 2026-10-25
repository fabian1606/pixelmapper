/**
 * Node suggestions (plan M5.2): suggestion rules, dismissals per user, the
 * Connectors-page component with Connect / Dismiss, and the bridge hints
 * (not running, Safari) — against the fake backend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readStoredConnectors, useConnectionsStore } from '~/stores/connections-store';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { setCurrentUserId } from '~/utils/extensions/connector-api';
import { getNodeDirectory, installArtNetBackend } from '../bridge/shared';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeNode } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector, activeNodeConnectors } from '../node/node-connector';
import { resetDismissedNodesForTests, suggestNodes, useDismissedNodes } from '../node/suggestions';
import NodeSuggestions from './NodeSuggestions.vue';

let backend: FakeArtNetBackend;

beforeEach(async () => {
  localStorage.clear();
  resetDismissedNodesForTests();
  setActivePinia(createPinia());
  // The host API (connectors, user key) and the user's loaded connector set.
  installSharedGlobals();
  setCurrentUserId(null);
  await useConnectionsStore().load(null);
  backend = new FakeArtNetBackend();
  installArtNetBackend(backend);
  getNodeDirectory();
});

afterEach(async () => {
  for (const c of [...activeNodeConnectors]) await c.disconnect();
  installArtNetBackend(null);
});

describe('suggestNodes', () => {
  it('suggests output nodes without a connector that were not dismissed', () => {
    const a = makeNode({ nodeId: 'A', shortName: 'Beta', ip: '2.0.0.2' });
    const b = makeNode({ nodeId: 'B', shortName: 'Alpha', ip: '2.0.0.3' });
    const byIp = makeNode({ nodeId: 'C', shortName: 'Waiting', ip: '10.0.0.50' });
    const controller = makeNode({ nodeId: 'D', style: 'controller' });
    const inputOnly = makeNode({ nodeId: 'E', ports: makeNode().ports.map(p => ({ ...p, canOutput: false, direction: 'input' as const })) });
    const dismissedNode = makeNode({ nodeId: 'F', shortName: 'Hidden' });
    const result = suggestNodes([a, b, byIp, controller, inputOnly, dismissedNode], [{ nodeId: 'X', ip: null }, { nodeId: null, ip: '10.0.0.50' }], new Set(['F']));
    expect(result.map(n => n.nodeId)).toEqual(['B', 'A']);
  });

  it('stores dismissals per user key', () => {
    useDismissedNodes().dismiss('7FF0:8A1B2C3D');
    expect(JSON.parse(localStorage.getItem('pm:artnet:dismissed-nodes:local')!)).toEqual(['7FF0:8A1B2C3D']);
    resetDismissedNodesForTests();
    expect(useDismissedNodes().dismissed.value.has('7FF0:8A1B2C3D')).toBe(true);
    useDismissedNodes().restore(['7FF0:8A1B2C3D']);
    expect(useDismissedNodes().dismissed.value.size).toBe(0);
  });

  it('follows the signed-in user (getUserKey)', () => {
    const { dismissed, dismiss } = useDismissedNodes();
    dismiss('A');
    setCurrentUserId('user-1');
    expect(dismissed.value.size).toBe(0); // another user's list
    dismiss('B');
    expect(JSON.parse(localStorage.getItem('pm:artnet:dismissed-nodes:user-1')!)).toEqual(['B']);
    setCurrentUserId(null);
    expect([...dismissed.value]).toEqual(['A']);
  });
});

describe('NodeSuggestions', () => {
  it('connects a found node as a connector and stops suggesting it', async () => {
    backend.start();
    backend.emit({ type: 'node', node: makeNode() });
    const wrapper = mount(NodeSuggestions);
    await nextTick();
    expect(wrapper.text()).toContain('Art-Net node found: PM Node · 2.27.44.61');

    await wrapper.findAll('button').find(b => b.text() === 'Connect')!.trigger('click');
    await nextTick();
    const store = useConnectionsStore();
    expect(store.connectors).toHaveLength(1);
    const c = store.connectors[0] as ArtNetNodeConnector;
    expect([c.meta.type, c.nodeId.value, c.outputCount]).toEqual(['artnet-node', '7FF0:8A1B2C3D', 4]);
    expect(c.status.value).toBe('connected');
    expect(wrapper.text()).not.toContain('Art-Net node found');
    wrapper.unmount();
  });

  it('dismisses a suggestion and can show it again', async () => {
    backend.start();
    backend.emit({ type: 'node', node: makeNode() });
    const wrapper = mount(NodeSuggestions);
    await nextTick();
    await wrapper.findAll('button').find(b => b.text() === 'Dismiss')!.trigger('click');
    expect(wrapper.text()).not.toContain('Art-Net node found');
    await wrapper.findAll('button').find(b => b.text().startsWith('Show dismissed'))!.trigger('click');
    expect(wrapper.text()).toContain('Art-Net node found');
    wrapper.unmount();
  });

  it('adds a node by IP', async () => {
    backend.start();
    const wrapper = mount(NodeSuggestions);
    await wrapper.findAll('button').find(b => b.text() === 'Add by IP')!.trigger('click');
    await wrapper.find('input').setValue('10.0.0.50');
    await wrapper.find('form').trigger('submit');
    const c = useConnectionsStore().connectors[0] as ArtNetNodeConnector;
    expect([c.ip.value, c.manual.value]).toEqual(['10.0.0.50', true]);
    expect(backend.pollTargets.get('10.0.0.50')).toBe(1);
    wrapper.unmount();

    // What the connector learns is saved without its card (connectors.persist).
    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.50' }) });
    await nextTick();
    expect(readStoredConnectors(null)[0]!.config).toMatchObject({ nodeId: '7FF0:8A1B2C3D', ports: ['1.0', '2.0', '3.0', '4.0'] });
  });

  it('explains how to start the bridge, and that Safari is unsupported', async () => {
    backend.disconnect();
    const wrapper = mount(NodeSuggestions);
    await nextTick();
    expect(wrapper.text()).toContain('pmnet serve');
    await wrapper.findAll('button').find(b => b.text() === 'Retry')!.trigger('click');
    expect(backend.reconnects).toBe(1);

    backend.state.value = { kind: 'unsupported', reason: 'Art-Net discovery is not supported in Safari. Use Chrome, Firefox or the desktop app.' };
    await nextTick();
    expect(wrapper.text()).toContain('Art-Net discovery is not supported in Safari');
    wrapper.unmount();
  });
});
