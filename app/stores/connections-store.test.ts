/**
 * Connectors as extensions (plan P6.1–P6.3): registry-driven creation,
 * per-user/device persistence in localStorage, frame routing.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ConnectorBase, defineConnector } from '@pixelmapper/extension-api';
import { registerExtension, resetRegistry } from '~/utils/extensions/registry';
import { connectorStorageKey, readStoredConnectors, useConnectionsStore } from './connections-store';

/** Test connector recording frames. */
class FakeConnector extends ConnectorBase {
  readonly meta = { type: 'fake', label: 'Fake' };
  frames: [number, number][] = [];
  host = 'a';
  constructor(id: string) { super(id); this.initOutputs(2); }
  async connect() { this.status.value = 'connected'; }
  async disconnect() { this.status.value = 'disconnected'; }
  override sendFrame(buf: Uint8Array, universe?: number) { this.frames.push([universe!, buf[0]!]); }
  override canAutoConnect() { return this.host === 'auto'; }
  override getConfig() { return { ...super.getConfig(), host: this.host }; }
  override applyConfig(c: Record<string, unknown>) { super.applyConfig(c); if (typeof c.host === 'string') this.host = c.host; }
}

beforeAll(() => {
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
});

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  resetRegistry();
  registerExtension({
    id: 'fake-out', version: '1.0.0', apiVersion: '^1.0.0', displayName: 'Fake', description: 'Fake connector for tests.',
    contributes: { connectors: [defineConnector({
      type: 'fake', label: 'Fake', icon: 'plug', description: 'Fake output.', direction: 'output',
      create: id => new FakeConnector(id),
      fromConfig: (id, c) => { const f = new FakeConnector(id); f.applyConfig(c); return f; },
    })] },
  });
});

describe('connections store', () => {
  it('persists per user and restores (keeping unknown types)', async () => {
    localStorage.setItem(connectorStorageKey('u1'), JSON.stringify([
      { id: 'x', type: 'fake', config: { host: 'auto', label: 'Stage', outputMapping: [3, 0] } },
      { id: 'y', type: 'missing', config: { a: 1 } },
    ]));
    const store = useConnectionsStore();
    await store.load('u1');
    expect(store.connectors).toHaveLength(1);
    const c = store.connectors[0] as unknown as FakeConnector;
    expect(c.label.value).toBe('Stage');
    expect(c.outputMapping.value).toEqual([3, 0]);
    expect(c.status.value).toBe('connected'); // auto-connected

    store.update('x', { host: 'b' });
    store.add(new FakeConnector('z'));
    const stored = readStoredConnectors('u1');
    expect(stored.map(s => s.id).sort()).toEqual(['x', 'y', 'z']);
    expect(stored.find(s => s.id === 'x')!.config.host).toBe('b');
    expect(readStoredConnectors('u2')).toEqual([]);

    store.remove('z');
    expect(readStoredConnectors('u1').map(s => s.id).sort()).toEqual(['x', 'y']);
  });

  it('routes mapped universes to connected outputs', async () => {
    const store = useConnectionsStore();
    await store.load(null);
    const c = new FakeConnector('a');
    c.applyConfig({ outputMapping: [2, 0] });
    store.add(c);
    await c.connect();
    const dmx = new Uint8Array(1024);
    dmx[512] = 77;
    store.sendFrame(dmx);
    expect(c.frames).toEqual([[2, 77]]);
  });
});
