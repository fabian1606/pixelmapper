/**
 * Extension API 1.4 for connectors: `connectors.add/list/remove/persist`,
 * `getUserKey`, `ConnectorDefinition.ownsOutputMapping` on the connector
 * card, and `FixtureSummary.extensionData`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ConnectorBase, connectors, defineConnector, getUserKey, listFixtures, type Connector } from '@pixelmapper/extension-api';
import { useConnectionsStore, readStoredConnectors } from '~/stores/connections-store';
import { useEngineStore } from '~/stores/engine-store';
import { Fixture } from '~/utils/engine/core/fixture';
import type { SceneNode } from '~/utils/engine/core/group';
import ConnectorCard from '~/components/connectors/ConnectorCard.vue';
import { registerExtension, resetRegistry } from './registry';
import { installSharedGlobals } from './shared-globals';
import { setCurrentUserId } from './connector-api';

/** Test connector with two outputs and a field it learns by itself. */
class LearningConnector extends ConnectorBase {
  readonly meta = { type: 'learning', label: 'Learning' };
  deviceId = '';
  constructor(id: string) { super(id); this.initOutputs(2); }
  async connect() { this.status.value = 'connected'; }
  async disconnect() { this.status.value = 'disconnected'; }
  override alwaysConnected() { return true; }
  override getConfig() { return { ...super.getConfig(), deviceId: this.deviceId }; }
}

/** Settings component of the type that owns its output mapping. */
const OwnSettings = defineComponent({ props: { connector: { type: Object, required: true } }, setup: () => () => h('div', 'own port table') });

/** Registers the test connector types (one owns its output mapping). */
function registerTypes() {
  registerExtension({
    id: 'test-connectors', version: '1.0.0', apiVersion: '^1.4.0', displayName: 'Test', description: 'Test connectors.',
    contributes: { connectors: [
      defineConnector({
        type: 'learning', label: 'Learning', icon: 'plug', description: 'Owns its mapping.', direction: 'output',
        create: id => new LearningConnector(id),
        fromConfig: id => new LearningConnector(id),
        settings: OwnSettings,
        ownsOutputMapping: true,
      }),
      defineConnector({
        type: 'plain', label: 'Plain', icon: 'plug', description: 'Generic mapping.', direction: 'output',
        create: id => Object.assign(new LearningConnector(id), { meta: { type: 'plain', label: 'Plain' } }),
        fromConfig: id => new LearningConnector(id),
      }),
    ] },
  });
}

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
  vi.stubGlobal('useSupabaseClient', () => ({}));
});

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  resetRegistry();
  installSharedGlobals();
  registerTypes();
  setCurrentUserId(null);
  await useConnectionsStore().load(null);
});

describe('connectors (API 1.4)', () => {
  it('adds, lists by type, persists learned config and removes instances', async () => {
    const c = new LearningConnector('a');
    connectors.add(c);
    await Promise.resolve();
    expect(c.status.value).toBe('connected'); // always connected: connected on add
    expect(connectors.list().map(x => x.id)).toEqual(['a']);
    expect(connectors.list('learning')).toHaveLength(1);
    expect(connectors.list('other')).toHaveLength(0);

    // A connector that learned something saves it without its card.
    c.deviceId = 'dev-7';
    connectors.persist('a');
    expect(readStoredConnectors(null)[0]!.config.deviceId).toBe('dev-7');
    connectors.persist('unknown'); // no-op

    connectors.remove('a');
    expect(c.status.value).toBe('disconnected');
    expect(connectors.list()).toHaveLength(0);
    expect(readStoredConnectors(null)).toEqual([]);
  });

  it('lists reactively', () => {
    const count = computed(() => connectors.list('learning').length);
    expect(count.value).toBe(0);
    connectors.add(new LearningConnector('b'));
    expect(count.value).toBe(1);
  });
});

describe('getUserKey (API 1.4)', () => {
  it('is the signed-in user id, else local, and reactive', () => {
    const key = computed(() => getUserKey());
    expect(key.value).toBe('local');
    setCurrentUserId('user-1');
    expect(key.value).toBe('user-1');
  });
});

describe('ConnectorCard with ownsOutputMapping', () => {
  /** Mounts the card of `connector`. */
  function card(connector: Connector) {
    return mount(ConnectorCard, { props: { connector } });
  }

  it('hides the generic Outputs section only for types that map outputs themselves', async () => {
    const own = new LearningConnector('own');
    useConnectionsStore().add(own);
    const ownCard = card(own);
    await nextTick();
    expect(ownCard.text()).toContain('own port table');
    expect(ownCard.text()).not.toContain('Outputs');

    const generic = Object.assign(new LearningConnector('gen'), { meta: { type: 'plain', label: 'Plain' } });
    const genericCard = card(generic);
    expect(genericCard.text()).toContain('Outputs');
    ownCard.unmount();
    genericCard.unmount();
  });
});

describe('FixtureSummary.extensionData (API 1.4)', () => {
  it('carries a copy of the extension data, only when present', () => {
    const linked = Fixture.createRGBFixture('f1');
    linked.extensionData = { 'test-ext': { link: { uid: 'X' } } };
    const plain = Fixture.createRGBFixture('f2');
    (useEngineStore().sceneNodes as SceneNode[]).push(linked, plain);
    const [a, b] = listFixtures();
    expect(a!.extensionData).toEqual({ 'test-ext': { link: { uid: 'X' } } });
    expect(a!.extensionData).not.toBe(linked.extensionData);
    expect(b!.extensionData).toBeUndefined();
  });
});
