/**
 * Node directory: state only from bridge events and snapshots (D5), cleared
 * without a bridge; plus a replayed bridge session end to end through the
 * WebSocket client.
 */
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { NodeDirectory } from './node-directory';
import { FakeArtNetBackend } from './testing/fake-backend';
import { FakeBridgeSocket } from './testing/fake-socket';
import { makeNode, makeTod } from './testing/fixtures';
import { WsBridgeBackend, type WebSocketFactory } from './ws-bridge-backend';
import { checkProtocol } from './protocol-messages';
import { decodeFrameSet, encodeFrameSet } from './frame-set';
import { formatPortAddress, parsePortKey, portKey } from './protocol-model';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('NodeDirectory', () => {
  it('follows node, nodeGone and tod events', async () => {
    const backend = new FakeArtNetBackend();
    const dir = new NodeDirectory(backend);
    backend.start();
    await flush();

    backend.emit({ type: 'node', node: makeNode() });
    expect(dir.getNode('7FF0:8A1B2C3D')?.ip).toBe('2.27.44.61');
    // IP change (DHCP / ArtIpProg): same id, new IP.
    backend.emit({ type: 'node', node: makeNode({ ip: '10.0.0.7' }) });
    expect(dir.findByIp('10.0.0.7')?.nodeId).toBe('7FF0:8A1B2C3D');
    expect(dir.findByIp('2.27.44.61')).toBeUndefined();

    backend.emit({ type: 'tod', ...makeTod('7FF0:8A1B2C3D', 1, ['7FF0:00000002', '7FF0:00000001']) });
    expect(dir.todOf('7FF0:8A1B2C3D', { bind: 1, index: 0 })?.uids).toEqual(['7FF0:00000001', '7FF0:00000002']);

    backend.emit({ type: 'nodeGone', nodeId: '7FF0:8A1B2C3D', lastSeen: 0 });
    expect(dir.nodes.size).toBe(0);
    expect(dir.tods.size).toBe(0);
    dir.dispose();
  });

  it('loads the snapshot on connect and clears when the bridge goes away', async () => {
    const backend = new FakeArtNetBackend(false);
    backend.handle('nodes', () => ({ nodes: [makeNode(), makeNode({ nodeId: 'mac:00:11:22:33:44:55', uid: null, shortName: 'Other', ip: '2.0.0.9' })], tods: [makeTod('7FF0:8A1B2C3D', 2, ['7FF0:00000003'])] }));
    const dir = new NodeDirectory(backend);
    backend.connect();
    await nextTick();
    await flush();
    expect(dir.list().map(n => n.shortName)).toEqual(['Other', 'PM Node']);
    expect(dir.todOf('7FF0:8A1B2C3D', { bind: 2, index: 0 })?.uids).toEqual(['7FF0:00000003']);

    backend.disconnect();
    await nextTick();
    expect(dir.nodes.size).toBe(0);
    dir.dispose();
  });

  it('replays a bridge session through the WebSocket client', async () => {
    FakeBridgeSocket.instances = [];
    const backend = new WsBridgeBackend({ url: () => 'ws://x', clientVersion: '1', WebSocketImpl: FakeBridgeSocket as unknown as WebSocketFactory });
    const dir = new NodeDirectory(backend);
    backend.start();
    const s = FakeBridgeSocket.last;
    s.handshake('1.4.0');
    await flush();
    s.answer('nodes', { nodes: [makeNode()], tods: [] });
    await flush();
    for (const msg of [
      { type: 'tod', ...makeTod('7FF0:8A1B2C3D', 1, ['7FF0:74B6510C']) },
      { type: 'node', node: makeNode({ shortName: 'Renamed' }) },
      { type: 'node', node: makeNode({ nodeId: 'mac:02:00:00:00:00:01', uid: null, ip: '2.0.0.20', shortName: 'Second' }) },
      { type: 'nodeGone', nodeId: 'mac:02:00:00:00:00:01', lastSeen: 1 },
    ]) s.receive(msg);
    expect(dir.list().map(n => n.shortName)).toEqual(['Renamed']);
    expect(dir.todOf('7FF0:8A1B2C3D', { bind: 1, index: 0 })?.uids).toEqual(['7FF0:74B6510C']);
    backend.stop();
    await nextTick();
    expect(dir.nodes.size).toBe(0);
    dir.dispose();
  });
});

describe('contract helpers', () => {
  it('checks protocol majors', () => {
    expect(checkProtocol('1.7.2', '1.0.0')).toBe('ok');
    expect(checkProtocol('2.0.0', '1.0.0')).toBe('appTooOld');
    expect(checkProtocol('0.3.0', '1.0.0')).toBe('bridgeTooOld');
    expect(checkProtocol('garbage', '1.0.0')).toBe('bridgeTooOld');
  });

  it('round-trips frame sets and port keys', () => {
    const msg = encodeFrameSet([{ route: 0x1234, data: new Uint8Array(600).fill(7) }, { route: 2, data: new Uint8Array(0) }], false);
    expect([...msg.subarray(0, 10)]).toEqual([0x50, 0x4d, 0x01, 0x00, 1, 0, 0x34, 0x12, 0x00, 0x02]);
    const decoded = decodeFrameSet(msg)!;
    expect(decoded.sync).toBe(false);
    expect(decoded.entries[0]!.data.length).toBe(512);
    expect(decodeFrameSet(msg.subarray(0, 20))).toBeNull();
    expect(parsePortKey(portKey({ bind: 2, index: 3 }))).toEqual({ bind: 2, index: 3 });
    expect(formatPortAddress(0x0123)).toBe('1:2:3');
  });
});
