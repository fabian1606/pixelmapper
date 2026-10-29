/**
 * `artnet` connector (plan M5.3/M5.4): identity and IP followed from
 * bridge events, outputs = node output ports with the default mapping
 * universe = Port-Address, status from bridge + node, DMX routed per port;
 * a device added by IP that never answers ArtPoll is a manual target
 * (universe → Port-Address outputs, DMX unicast to its IP).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { NodeDirectory } from '../bridge/node-directory';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeNode, makePort } from '../bridge/testing/fixtures';
import { ArtNetNodeConnector, activeNodeConnectors } from './node-connector';
import { adoptManualOutputs, defaultUniverse, portAddressForUniverse, reconcileOutputs } from './output-ports';

/** A connected fake backend with its directory. */
async function setup() {
  const backend = new FakeArtNetBackend();
  const directory = new NodeDirectory(backend);
  backend.start();
  await nextTick();
  return { backend, directory, deps: { backend, directory } };
}

const connectors: ArtNetNodeConnector[] = [];
afterEach(async () => {
  for (const c of connectors.splice(0)) await c.disconnect();
});

/** Creates and tracks a connector. */
function create(config: Record<string, unknown>, deps: { backend: FakeArtNetBackend; directory: NodeDirectory }) {
  const c = ArtNetNodeConnector.fromConfig(crypto.randomUUID(), config, deps);
  connectors.push(c);
  return c;
}

describe('ArtNetNodeConnector — node binding', () => {
  it('builds the config of a discovered node with the default mapping', () => {
    const config = ArtNetNodeConnector.configForNode(makeNode());
    expect(config).toMatchObject({ label: 'PM Node', nodeId: '7FF0:8A1B2C3D', ip: '2.27.44.61', ports: ['1.0', '2.0', '3.0', '4.0'], outputCount: 4, outputMapping: [1, 2, 3, 4] });
  });

  it('is connected while the bridge is connected and the node answers', async () => {
    const { backend, deps } = await setup();
    const c = create(ArtNetNodeConnector.configForNode(makeNode()), deps);
    expect(c.alwaysConnected()).toBe(true);
    await c.connect();
    expect(activeNodeConnectors.has(c)).toBe(true);
    expect(c.status.value).toBe('connecting');
    expect(c.errorMessage.value).toMatch(/Node offline/);

    backend.emit({ type: 'node', node: makeNode() });
    await nextTick();
    expect(c.status.value).toBe('connected');
    expect(c.errorMessage.value).toBeNull();

    // A rejected DMX route table is shown; accepted routes keep their output.
    backend.dmxError.value = 'duplicate route 1';
    await nextTick();
    expect([c.status.value, c.errorMessage.value]).toEqual(['connected', 'The bridge rejected the DMX routes: duplicate route 1']);
    backend.dmxError.value = null;
    await nextTick();

    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.7' }) });
    await nextTick();
    expect(c.ip.value).toBe('10.0.0.7');
    expect(c.getConfig().ip).toBe('10.0.0.7');
    expect(c.logs.map(l => l.text).join('\n')).toMatch(/IP changed 2\.27\.44\.61 → 10\.0\.0\.7/);

    backend.emit({ type: 'nodeGone', nodeId: '7FF0:8A1B2C3D', lastSeen: 0 });
    await nextTick();
    expect(c.status.value).toBe('connecting');

    backend.disconnect();
    await nextTick();
    expect(c.errorMessage.value).toMatch(/pmnet-bridge serve/);
    backend.state.value = { kind: 'incompatible', url: 'ws://x', reason: 'bridgeTooOld', bridgeVersion: '0.1.0', protocol: '0.9.0' };
    await nextTick();
    expect(c.status.value).toBe('error');
    expect(c.errorMessage.value).toMatch(/Bridge update needed/);

    await c.connect(); // Retry
    expect(backend.reconnects).toBe(1);
    await c.disconnect();
    expect(activeNodeConnectors.has(c)).toBe(false);
  });

  it('binds a node added by IP and polls that IP', async () => {
    const { backend, deps } = await setup();
    const c = create({ ip: '10.0.0.50', manual: true }, deps);
    await c.connect();
    expect(backend.pollTargets.get('10.0.0.50')).toBe(1);
    // Until it answers, the device is a manual target: DMX can flow unicast.
    expect(c.isManualTarget.value).toBe(true);
    expect([c.status.value, c.errorMessage.value]).toEqual(['connected', null]);

    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.50', shortName: 'Stage left' }) });
    await nextTick();
    expect(c.nodeId.value).toBe('7FF0:8A1B2C3D');
    expect(c.label.value).toBe('Stage left');
    expect(c.outputCount).toBe(4);
    expect(c.outputMapping.value).toEqual([1, 2, 3, 4]);
    expect(c.getConfig()).toMatchObject({ nodeId: '7FF0:8A1B2C3D', manual: true, ports: ['1.0', '2.0', '3.0', '4.0'] });

    await c.disconnect();
    expect(backend.pollTargets.size).toBe(0);
  });

  it('keeps per-port mappings when ports change direction', async () => {
    const { backend, deps } = await setup();
    const c = create({ ...ArtNetNodeConnector.configForNode(makeNode()), outputMapping: [10, 11, 12, 13] }, deps);
    await c.connect();
    const ports = makeNode().ports;
    ports[1] = makePort(2, 2, { canOutput: false, canInput: true, direction: 'input' });
    backend.emit({ type: 'node', node: makeNode({ ports }) });
    await nextTick();
    expect(c.ports.value.map(p => p.bind)).toEqual([1, 3, 4]);
    expect(c.outputMapping.value).toEqual([10, 12, 13]);
  });
});

describe('ArtNetNodeConnector — DMX out', () => {
  it('sends a universe to every port mapped to it, by the node’s Port-Address', async () => {
    const { backend, deps } = await setup();
    backend.emit({ type: 'node', node: makeNode() });
    const c = create({ ...ArtNetNodeConnector.configForNode(makeNode()), outputMapping: [2, 2, 0, 7] }, deps);
    await c.connect();
    const data = new Uint8Array(512).fill(3);
    c.sendFrame(data, 2);
    c.sendFrame(data, 7);
    c.sendFrame(data, 5);
    expect(backend.dmx.map(d => d.target)).toEqual([
      { nodeId: '7FF0:8A1B2C3D', portAddress: 1 },
      { nodeId: '7FF0:8A1B2C3D', portAddress: 2 },
      { nodeId: '7FF0:8A1B2C3D', portAddress: 4 },
    ]);

    backend.emit({ type: 'nodeGone', nodeId: '7FF0:8A1B2C3D', lastSeen: 0 });
    c.sendFrame(data, 2);
    expect(backend.dmx).toHaveLength(3);
  });
});

describe('ArtNetNodeConnector — manual target', () => {
  it('sends unicast to the IP by the configured Port-Address while the device does not answer ArtPoll', async () => {
    const { backend, deps } = await setup();
    const c = create({ ...ArtNetNodeConnector.configForIp('10.0.0.60', 'Old dimmer'), ...ArtNetNodeConnector.manualOutputsPatch([{ universe: 1, portAddress: 0 }, { universe: 3, portAddress: 17 }, { universe: 1, portAddress: 5 }]) }, deps);
    await c.connect();
    expect([c.isManualTarget.value, c.status.value, c.outputCount, c.label.value]).toEqual([true, 'connected', 3, 'Old dimmer']);
    expect(c.getConfig()).toMatchObject({ ip: '10.0.0.60', manual: true, nodeId: null, ports: [], portAddresses: [0, 17, 5], outputMapping: [1, 3, 1] });

    const data = new Uint8Array(512).fill(9);
    c.sendFrame(data, 1);
    c.sendFrame(data, 3);
    c.sendFrame(data, 2);
    expect(backend.dmx.map(d => d.target)).toEqual([
      { ip: '10.0.0.60', portAddress: 0 },
      { ip: '10.0.0.60', portAddress: 5 },
      { ip: '10.0.0.60', portAddress: 17 },
    ]);
  });

  it('starts with one output U1 → Port-Address 1 and becomes a discovered device once it answers ArtPoll', async () => {
    const { backend, deps } = await setup();
    const c = create({ ...ArtNetNodeConnector.configForIp('10.0.0.50'), ...ArtNetNodeConnector.manualOutputsPatch([{ universe: 7, portAddress: 2 }]) }, deps);
    expect(ArtNetNodeConnector.configForIp('10.0.0.50')).toMatchObject({ portAddresses: [1], outputMapping: [1], outputCount: 1 });
    await c.connect();

    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.50' }) });
    await nextTick();
    expect(c.isManualTarget.value).toBe(false);
    expect(c.nodeId.value).toBe('7FF0:8A1B2C3D');
    // Port 2 has Port-Address 2, which the manual output used for U7; the others get the default.
    expect(c.outputMapping.value).toEqual([1, 7, 3, 4]);
    expect(c.getConfig()).toMatchObject({ portAddresses: [], ports: ['1.0', '2.0', '3.0', '4.0'] });
    expect(c.logs.map(l => l.text).join('\n')).toMatch(/now a discovered device/);

    // Offline later: the connector stays bound to the node, no unicast fallback.
    backend.emit({ type: 'nodeGone', nodeId: '7FF0:8A1B2C3D', lastSeen: 0 });
    await nextTick();
    expect([c.isManualTarget.value, c.status.value]).toEqual([false, 'connecting']);
    c.sendFrame(new Uint8Array(512), 7);
    expect(backend.dmx).toHaveLength(0);
  });

  it('is not a manual target without the bridge connection', async () => {
    const { backend, deps } = await setup();
    const c = create(ArtNetNodeConnector.configForIp('10.0.0.70'), deps);
    await c.connect();
    backend.disconnect();
    await nextTick();
    expect(c.status.value).toBe('connecting');
  });
});

describe('output ports', () => {
  it('reconciles outputs and matches universes to Port-Addresses', () => {
    const node = makeNode();
    expect(reconcileOutputs([{ bind: 3, index: 0 }], [42], node.ports).mapping).toEqual([1, 2, 42, 4]);
    // The deprecated Port-Address 0 defaults to U1; a universe matches the same Port-Address.
    expect(defaultUniverse(makePort(1, 0))).toBe(1);
    expect([portAddressForUniverse(1), portAddressForUniverse(32767), portAddressForUniverse(32768), portAddressForUniverse(0)]).toEqual([1, 32767, null, null]);
    // Manual outputs map onto the node's ports by Port-Address; unassigned outputs are ignored.
    expect(adoptManualOutputs([3, 1, 4], [20, 0, 21], node.ports).mapping).toEqual([1, 2, 20, 21]);
  });
});
