/**
 * Device store (plan M6.1, D5): devices from TODs, described once, DEVICE_INFO
 * re-read on TOD change / periodically / after a panel SET, presence from
 * the TOD, SETs with the device's answer as the state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { NodeDirectory } from '../bridge/node-directory';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { makeTodNak } from '../bridge/testing/fixtures';
import { DeviceStore } from './device-store';
import { FakeRdmDevices } from './testing/fake-devices';

let backend: FakeArtNetBackend;
let directory: NodeDirectory;
let tubes: FakeRdmDevices;
let store: DeviceStore;
let tracked: string[];

/** Lets the fake bridge answer (promise chains). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>(r => setTimeout(r, 0));
};

beforeEach(async () => {
  backend = new FakeArtNetBackend();
  directory = new NodeDirectory(backend);
  backend.start();
  await nextTick();
  tubes = new FakeRdmDevices(backend);
  tracked = [tubes.node.nodeId];
  store = new DeviceStore({ backend, directory, nodeIds: () => tracked, rereadMs: 1000 });
});

afterEach(() => {
  store.stop();
  vi.useRealTimers();
});

describe('DeviceStore', () => {
  it('describes the devices of the tracked nodes from their TODs', async () => {
    tubes.add('7FF0:00000001', 1, { dmxStartAddress: 1 }, 'Tube A');
    tubes.add('7FF0:00000002', 1, { dmxStartAddress: 13 });
    tubes.add('7FF0:00000003', 2, { dmxStartAddress: 1, currentPersonality: 2 });
    store.start();
    tubes.announce();
    await settle();
    const list = store.devicesOf(tubes.node.nodeId);
    expect(list.map(d => [d.uid, d.port.bind, d.info?.dmxStartAddress, d.present])).toEqual([
      ['7FF0:00000001', 1, 1, true], ['7FF0:00000002', 1, 13, true], ['7FF0:00000003', 2, 1, true],
    ]);
    expect(list[0]!.description?.deviceLabel).toBe('Tube A');
    expect(list[2]!.info?.dmxFootprint).toBe(3);
    expect(backend.requests.filter(r => r.type === 'rdmDescribe')).toHaveLength(3);
  });

  it('ignores nodes without a connector', async () => {
    tubes.add('7FF0:00000001', 1);
    tracked = [];
    store.start();
    tubes.announce();
    await settle();
    expect(store.devices.size).toBe(0);
  });

  it('marks unplugged devices absent and re-reads the rest of the port', async () => {
    tubes.add('7FF0:00000001', 1);
    tubes.add('7FF0:00000002', 1, { dmxStartAddress: 13 });
    store.start();
    tubes.announce();
    await settle();
    const reads = backend.requests.filter(r => r.type === 'rdmGet').length;
    tubes.unplug('7FF0:00000002');
    await settle();
    expect(store.get('7FF0:00000002')?.present).toBe(false);
    expect(store.get('7FF0:00000001')?.present).toBe(true);
    expect(backend.requests.filter(r => r.type === 'rdmGet').length).toBe(reads + 1); // TOD change → re-read

    backend.emit({ type: 'nodeGone', nodeId: tubes.node.nodeId, lastSeen: 0 });
    await settle();
    expect(store.get('7FF0:00000001')?.present).toBe(false);
  });

  it('drops the devices of a port that answers TodNak and names the port (contract rev 2)', async () => {
    tubes.add('7FF0:00000001', 1);
    tubes.add('7FF0:00000002', 2);
    store.start();
    tubes.announce();
    await settle();
    expect(store.portsWithoutRdm(tubes.node.nodeId)).toEqual([]);

    // RDM switched off on port 2 (or the port became an input): TodNak.
    backend.emit({ type: 'tod', ...makeTodNak(tubes.node.nodeId, 2) });
    await settle();
    expect(store.get('7FF0:00000002')).toBeUndefined(); // not kept as a stale offline entry
    expect(store.get('7FF0:00000001')?.present).toBe(true);
    expect(store.portsWithoutRdm(tubes.node.nodeId)).toEqual([{ bind: 2, index: 0 }]);

    // RDM back on: the device is listed and described again.
    tubes.emitTod(2);
    await settle();
    expect(store.get('7FF0:00000002')?.present).toBe(true);
    expect(store.portsWithoutRdm(tubes.node.nodeId)).toEqual([]);
  });

  it('re-reads after a SET from the node panel and periodically', async () => {
    vi.useFakeTimers();
    tubes.add('7FF0:00000001', 1);
    store.start();
    tubes.announce();
    await vi.advanceTimersByTimeAsync(0);
    tubes.changeFromPanel('7FF0:00000001', { dmxStartAddress: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get('7FF0:00000001')?.info?.dmxStartAddress).toBe(100);

    tubes.devices.get('7FF0:00000001')!.info.dmxStartAddress = 7; // silently, e.g. a DMX console
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.get('7FF0:00000001')?.info?.dmxStartAddress).toBe(7);

    tubes.devices.get('7FF0:00000001')!.failWith = 'timeout';
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.get('7FF0:00000001')).toMatchObject({ noAnswer: true, error: 'The device does not answer', present: true });
  });

  it('writes address, personality and identify; the state is the device answer', async () => {
    tubes.add('7FF0:00000001', 1);
    store.start();
    tubes.announce();
    await settle();
    await store.setStartAddress('7FF0:00000001', 40);
    expect(store.get('7FF0:00000001')?.info?.dmxStartAddress).toBe(40);
    await store.setPersonality('7FF0:00000001', 4);
    expect(store.get('7FF0:00000001')?.info).toMatchObject({ currentPersonality: 4, dmxFootprint: 13 });
    await store.identify('7FF0:00000001', true);
    expect(store.get('7FF0:00000001')?.identifying).toBe(true);
    await expect(store.setStartAddress('7FF0:00000001', 600)).rejects.toThrow(/refused \(DATA_OUT_OF_RANGE\)/);
    expect(store.get('7FF0:00000001')?.error).toMatch(/refused/);
  });

  it('rediscovers with ArtTodControl flush', async () => {
    tubes.add('7FF0:00000001', 1);
    store.start();
    tubes.announce();
    await settle();
    tubes.add('7FF0:00000009', 1);
    await store.rediscover(tubes.node.nodeId, [{ bind: 1, index: 0 }]);
    await settle();
    expect(backend.requests.find(r => r.type === 'todControl')?.args).toMatchObject({ action: 'flush', port: { bind: 1, index: 0 } });
    expect(store.get('7FF0:00000009')?.present).toBe(true);
  });

  it('writes DEVICE_LABEL and shows the label the device reads back', async () => {
    tubes.add('7FF0:00000001', 1, {}, 'Old');
    store.start();
    tubes.announce();
    await settle();
    await expect(store.setDeviceLabel('7FF0:00000001', 'Stage left')).resolves.toBe('Stage left');
    expect(store.get('7FF0:00000001')!.description?.deviceLabel).toBe('Stage left');
    expect(tubes.sets.at(-1)).toEqual({ uid: '7FF0:00000001', pid: 0x0082, value: 'Stage left' });
    await expect(store.setDeviceLabel('7FF0:00000001', 'x'.repeat(33))).rejects.toThrow(/32 characters/);
  });

  it('holds reads of a device while its firmware is written', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    tubes.add('7FF0:00000001', 1);
    store.start();
    tubes.announce();
    await settle();
    const reads = () => backend.requests.filter(r => r.type === 'rdmGet' || r.type === 'rdmDescribe').length;
    const before = reads();
    const release = store.holdReads('7FF0:00000001');
    expect(store.isHeld('7FF0:00000001')).toBe(true);
    vi.advanceTimersByTime(1000);
    await store.readInfo('7FF0:00000001');
    await store.describe('7FF0:00000001', true);
    await settle();
    expect(reads()).toBe(before); // nothing sent while held
    release();
    release(); // twice is a no-op
    expect(store.isHeld('7FF0:00000001')).toBe(false);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(reads()).toBe(before + 1); // the periodic re-read resumes
  });
});
