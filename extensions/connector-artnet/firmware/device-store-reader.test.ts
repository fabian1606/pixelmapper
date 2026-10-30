/**
 * Tube readings from the device store (plan M7.4 on M6): no RDM GETs for
 * tubes the store knows, one DEVICE_INFO for a forced re-read, and a direct
 * read for tubes the store does not track.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { NodeDirectory } from '../bridge/node-directory';
import { RDM_PID } from '../bridge/rdm-constants';
import { FakeArtNetBackend } from '../bridge/testing/fake-backend';
import { DeviceStore } from '../devices/device-store';
import { FakeRdmDevices } from '../devices/testing/fake-devices';
import { deviceStoreTubeReader } from './device-store-reader';
import type { NodeTube } from './tube-devices';

const A = '7FF0:00000001';

let backend: FakeArtNetBackend;
let tubes: FakeRdmDevices;
let store: DeviceStore;

/** Lets the fake bridge answer. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>(r => setTimeout(r, 0));
};

/** The dialog's view of a tube on port `bind`. */
const tube = (uid: string, bind = 1): NodeTube => ({ nodeId: tubes.node.nodeId, port: { bind, index: 0 }, portLabel: `Port ${bind}`, uid });
/** DEVICE_INFO GETs sent so far. */
const infoGets = () => backend.requests.filter(r => r.type === 'rdmGet' && (r.args as { pid: number }).pid === RDM_PID.DEVICE_INFO).length;

beforeEach(async () => {
  backend = new FakeArtNetBackend();
  const directory = new NodeDirectory(backend);
  backend.start();
  await nextTick();
  tubes = new FakeRdmDevices(backend);
  tubes.add(A, 1);
  store = new DeviceStore({ backend, directory, nodeIds: () => [tubes.node.nodeId], rereadMs: 60_000 });
  store.start();
  tubes.announce();
  await settle();
});

afterEach(() => store.stop());

describe('deviceStoreTubeReader', () => {
  it('answers from the store without RDM GETs', async () => {
    const read = deviceStoreTubeReader(store, backend);
    const before = backend.requests.length;
    await expect(read(tube(A))).resolves.toEqual({ state: 'ok', deviceModelId: 1, softwareVersionId: 0x500, softwareVersionLabel: '0.5.0' });
    expect(backend.requests.length).toBe(before);
  });

  it('re-reads DEVICE_INFO once when asked for a fresh answer, and drops a label of another version', async () => {
    const read = deviceStoreTubeReader(store, backend);
    const before = infoGets();
    tubes.devices.get(A)!.info = { ...tubes.devices.get(A)!.info, softwareVersionId: 0x010200 };
    const reading = await read(tube(A), { fresh: true });
    expect(infoGets()).toBe(before + 1);
    // The description still names 0.5.0 — not the version the tube runs now.
    expect(reading).toEqual({ state: 'ok', deviceModelId: 1, softwareVersionId: 0x010200, softwareVersionLabel: null });
    expect(store.get(A)!.info?.softwareVersionId).toBe(0x010200); // the store learned it too
  });

  it('reads tubes the store does not track directly', async () => {
    const read = deviceStoreTubeReader(null, backend);
    const before = infoGets();
    const reading = await read(tube(A));
    expect(reading.state).toBe('ok');
    expect(infoGets()).toBe(before + 1);
  });

  it('reports a device that does not answer', async () => {
    tubes.devices.get(A)!.failWith = 'timeout';
    const read = deviceStoreTubeReader(store, backend);
    const reading = await read(tube(A), { fresh: true });
    expect(reading.state).toBe('error');
  });
});
